'use strict';
// 플레이스 체크 서버 — 06번 §3 큐·캐시·쿨다운. 외부 패키지 0.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parsePlaceUrl } = require('./lib/url-parse');
const P = require('./lib/place-parse');
const { factsToAnswers } = require('./lib/facts-to-answers');
const S = require('./lib/place-scoring');
const K = require('./lib/keyword');
const D = require('./lib/draft');
const R = require('./lib/review-insight');

// .env (선택): KEY=VALUE 줄만, 이미 있는 process.env는 덮어쓰지 않음
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없음 */ }
const PORT = Number(process.env.PORT) || 8090;
const PUBLIC = path.join(__dirname, 'public');
const LIB = path.join(__dirname, 'lib');
const CACHE_DIR = process.env.PLACE_CACHE_DIR || path.join(__dirname, 'data', 'cache');
const CACHE_TTL_MS = 24 * 3600 * 1000;
const REFRESH_MIN_MS = 10 * 60 * 1000; // '다시 읽어오기'는 마지막 수집 후 10분 지나야 허용
const FETCH_GAP_MS = 1500;
const FETCH_TIMEOUT_MS = 8000;
const REQUEST_DEADLINE_MS = 90 * 1000;
const QUEUE_MAX = 200;
const COOLDOWN_MS = 30 * 60 * 1000;
const IP_LIMIT = 3; // 새 수집 작업 / 60초
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TABS = ['review/visitor', 'information', 'feed', 'photo']; // 홈 다음 우선순위(06 §3 + 리뷰 탭 추가)
const BUDGET = 6; // 홈 + 탭 4 + 재시도 여유 1 (단축 URL 해석 시 photo 생략)

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---------- 상태 ----------
const state = {
  cooldownUntil: 0,      // epoch ms, 0 = 정상
  probing: false,        // 쿨다운 만료 후 시험 요청 진행 중
  jobs: new Map(),       // placeId -> job {placeId, type, waiters:[], started}
  queue: [],             // placeId 순서
  running: false,
  lastFetchStart: 0,
  ipLog: new Map(),      // ip -> [epoch ms]
  fetchImpl: globalThis.fetch,
  llm: undefined,          // review-insight LLM 호출 함수(테스트 주입); undefined = ANTHROPIC_API_KEY 있으면 실제 호출
  now: () => Date.now(),
};

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const cachePath = (id) => path.join(CACHE_DIR, `${id}.json`);

function readCache(placeId, maxAge = CACHE_TTL_MS) {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(placeId), 'utf8'));
    const age = state.now() - Date.parse(j.fetched_at);
    if (age >= 0 && age < maxAge) return j;
  } catch { /* miss */ }
  return null;
}
function writeCache(placeId, facts) {
  const tmp = cachePath(placeId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(facts));
  fs.renameSync(tmp, cachePath(placeId));
}

function inCooldown() { return state.now() < state.cooldownUntil; }
function startCooldown() {
  state.cooldownUntil = state.now() + COOLDOWN_MS;
  state.probing = false;
  // 진행·대기 전부 폴백 종료
  for (const job of state.jobs.values()) finishJob(job, { mode: 'fallback', reason: 'cooldown' });
  state.queue.length = 0;
}

function ipAllowed(ip) {
  const t = state.now();
  const arr = (state.ipLog.get(ip) || []).filter((x) => t - x < 60_000);
  state.ipLog.set(ip, arr);
  if (arr.length >= IP_LIMIT) return false;
  arr.push(t);
  return true;
}

// ---------- fetch (간격·타임아웃·차단 감지) ----------
async function gapWait() {
  const wait = state.lastFetchStart + FETCH_GAP_MS - state.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  state.lastFetchStart = state.now();
}
class Blocked extends Error {}
async function fetchText(url) {
  await gapWait();
  const res = await state.fetchImpl(url, {
    headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (res.status === 429) throw new Blocked('429');
  const text = await res.text();
  if (/보안 확인|자동 입력 방지|captcha/i.test(text) && !text.includes('__APOLLO_STATE__')) throw new Blocked('captcha');
  return { status: res.status, text, url: res.url };
}

// ---------- 작업 실행 ----------
async function collect(job) {
  let budget = BUDGET;
  let placeId = job.placeId;
  let type = job.type || 'place';
  if (job.shortUrl) {
    budget -= 1;
    const r = await fetchText(job.shortUrl);
    const parsed = parsePlaceUrl(r.url);
    if (!parsed.ok || parsed.needsResolve) return { mode: 'fallback', reason: 'unsupported_url' };
    placeId = parsed.placeId; type = parsed.type || 'place';
    const cached = readCache(placeId, job.refresh ? REFRESH_MIN_MS : CACHE_TTL_MS);
    if (cached) return { facts: cached, placeId };
  }
  const base = `https://pcmap.place.naver.com/${type}/${placeId}`;
  const home = await fetchText(`${base}/home`);
  budget -= 1;
  let facts = home.status === 200 ? P.parseHome(home.text) : null;
  if (!facts) return { mode: 'fallback', reason: 'unreadable' };
  facts = { ...facts, fetched_at: new Date(state.now()).toISOString() }; // 서버 시계 기준(테스트 주입 가능)
  for (const tab of TABS) {
    if (budget <= 0) break;
    budget -= 1;
    let r;
    try {
      try { r = await fetchText(`${base}/${tab}`); }
      catch (e) { if (e instanceof Blocked || budget <= 0) throw e; budget -= 1; r = await fetchText(`${base}/${tab}`); } // 비차단 실패(타임아웃 등) 1회 재시도
      if (r.status !== 200) continue;
      if (tab === 'review/visitor') facts = P.parseReviewVisitor(r.text, facts, { now: new Date(state.now()) });
      if (tab === 'information') facts = P.parseInformation(r.text, facts);
      if (tab === 'feed') facts = P.parseFeed(r.text, facts);
      if (tab === 'photo') facts = P.parsePhoto(r.text, facts);
    } catch (e) {
      if (e instanceof Blocked) throw e; // 탭 차단도 서버 공통 쿨다운
      // 비차단 실패 → 해당 필드 missing 유지
    }
  }
  writeCache(placeId, facts);
  return { facts, placeId };
}

function finishJob(job, payload) {
  state.jobs.delete(job.key);
  const i = state.queue.indexOf(job.key);
  if (i >= 0) state.queue.splice(i, 1);
  for (const w of job.waiters) w(payload);
  job.waiters = [];
}

async function pump() {
  if (state.running) return;
  state.running = true;
  try {
    while (state.queue.length) {
      if (inCooldown()) { for (const k of [...state.queue]) { const j = state.jobs.get(k); if (j) finishJob(j, { mode: 'fallback', reason: 'cooldown' }); } break; }
      const key = state.queue[0];
      const job = state.jobs.get(key);
      if (!job) { state.queue.shift(); continue; }
      if (!job.waiters.length) { finishJob(job, null); continue; } // 대기자 0 → 제거
      const cached = job.placeId && readCache(job.placeId, job.refresh ? REFRESH_MIN_MS : CACHE_TTL_MS);
      if (cached) { finishJob(job, { facts: cached, placeId: job.placeId }); continue; }
      const wasProbe = state.probing;
      try {
        job.started = true;
        const out = await collect(job);
        if (wasProbe) state.probing = false; // 시험 성공 → 정상
        finishJob(job, out);
      } catch (e) {
        if (e instanceof Blocked) { startCooldown(); break; }
        if (wasProbe) state.probing = false; // 비차단 실패 → 정상 복귀
        finishJob(job, { mode: 'fallback', reason: 'unreadable' });
      }
    }
  } finally { state.running = false; }
}

function enqueue(parsed) {
  const key = parsed.needsResolve ? `s:${parsed.shortUrl}` : parsed.placeId;
  let job = state.jobs.get(key);
  if (job) return job; // 합류
  if (state.queue.length >= QUEUE_MAX) return null;
  job = { key, placeId: parsed.placeId, type: parsed.type, shortUrl: parsed.shortUrl, waiters: [], started: false, refresh: !!parsed.refresh };
  state.jobs.set(key, job);
  state.queue.push(key);
  return job;
}

// ---------- 결과 조립 ----------
async function buildResponse(facts, asOf, queuedPosition) {
  const v = (o) => (o && o.status === 'value' ? o.value : null);
  const { answers, auto } = factsToAnswers(facts, { asOf });
  const result = S.computeScore(answers, { asOf });
  const district = K.extractDistrict(v(facts.roadAddress) || '');
  const station = (v(facts.subwayStations) || [])[0] || null;
  const cat = K.normalizeCategory(v(facts.category) || '');
  const menus = (v(facts.menus) || []);
  const recMenus = [...menus].sort((a, b) => (b.recommend === true) - (a.recommend === true) || a.order - b.order);
  const kwMenus = [...new Set(recMenus.map((m) => K.menuForKeyword(m.name)).filter(Boolean))].slice(0, 2);
  const conv = v(facts.conveniences) || [];
  const situations = [];
  if (conv.includes('단체 이용 가능')) situations.push('회식');
  if (conv.includes('포장')) situations.push('포장');
  if (conv.includes('배달')) situations.push('배달');
  if (conv.includes('주차')) situations.push('주차');
  const existing = v(facts.keywords) || [];
  const kctx = { name: v(facts.name), district, station, category: v(facts.category) || '', menus: kwMenus };
  const keywords = {
    current: existing,
    diagnosis: K.diagnoseKeywords(existing, kctx),
    recommendations: K.recommendKeywords({ district, station, categoryNorm: cat.norm, suffix: cat.suffix, menus: kwMenus, situations, existing }),
  };
  const hours = v(facts.businessHours);
  const hoursLine = hours && hours.length ? `${hours[0].day}~${hours[hours.length - 1].day} ${hours[0].start}~${hours[0].end}` : undefined;
  const booking = auto.C1 && auto.C1.state === 'pass' ? 'naver' : (v(facts.virtualPhone) || v(facts.phone)) ? 'phone' : null;
  const draft = D.buildDraft({
    name: v(facts.name), station, district, categoryNorm: cat.norm,
    menus: recMenus.slice(0, 2).map((m) => ({ name: m.name, price: m.price && m.price.status === 'value' ? m.price.value : undefined })),
    hours: hoursLine, parking: v(facts.parkingInfo) || (conv.includes('주차') ? '주차 가능' : undefined),
    booking, phone: v(facts.virtualPhone) || v(facts.phone) || undefined,
    takeout: conv.includes('포장'), delivery: conv.includes('배달'), group: conv.includes('단체 이용 가능'),
    accessor: v(facts.accessor) || undefined,
  });
  // LLM 요약은 facts와 함께 캐시(24h) — 캐시 hit마다 재호출·재과금 방지
  let insight;
  if (facts.insight_llm !== undefined) insight = await R.buildInsight(facts, { asOf, llm: async () => facts.insight_llm });
  else {
    insight = await R.buildInsight(facts, { asOf, llm: state.llm });
    const pid = v(facts.placeId);
    if (insight && pid) { try { writeCache(pid, { ...facts, insight_llm: insight.llm || null }); } catch { /* 캐시 실패 무시 */ } }
  }
  return {
    mode: 'auto', as_of: asOf, queued_position: queuedPosition, insight,
    place: { id: v(facts.placeId), name: v(facts.name), category: v(facts.category), address: v(facts.roadAddress), district, station, fetched_at: facts.fetched_at },
    answers, auto, result, todos: S.pickTodos(result), supplement: S.pickSupplement(result), keywords, draft,
  };
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function serveStatic(req, res) {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const file = p.startsWith('/lib/') ? path.join(LIB, p.slice(5)) : path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC) && !file.startsWith(LIB)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    const ext = path.extname(file);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(buf);
  });
}

async function handleCheck(req, res, body) {
  let input;
  try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { mode: 'fallback', reason: 'bad_request' }); }
  const parsed = parsePlaceUrl(String(input.url || ''));
  if (!parsed.ok) return send(res, 200, { mode: 'fallback', reason: parsed.reason });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const asOf = kstDate(state.now());
  const refresh = input.refresh === true;
  // 캐시 hit — 쿨다운·IP 한도 무관. refresh면 10분 이내 수집분만 재사용(그보다 오래됐으면 새로 읽음)
  if (!parsed.needsResolve) {
    const cached = readCache(parsed.placeId, refresh ? REFRESH_MIN_MS : CACHE_TTL_MS);
    if (cached) { const out = await buildResponse(cached, asOf, 0); out.cache = { hit: true, refresh_denied: refresh }; return send(res, 200, out); }
  }
  if (inCooldown()) {
    // 만료 여부는 inCooldown이 판단. 여기 왔다면 아직 쿨다운 중
    return send(res, 200, { mode: 'fallback', reason: 'cooldown' });
  }
  if (state.probing) {
    // 시험 중: 같은 작업 합류만 허용, 다른 miss는 폴백
    const key = parsed.needsResolve ? `s:${parsed.shortUrl}` : parsed.placeId;
    if (!state.jobs.has(key)) return send(res, 200, { mode: 'fallback', reason: 'cooldown' });
  }
  if (!ipAllowed(ip)) return send(res, 429, { mode: 'fallback', reason: 'ip_limit' });
  const job = enqueue({ ...parsed, refresh });
  if (!job) return send(res, 200, { mode: 'fallback', reason: 'busy' });
  if (state.cooldownUntil && !state.probing && state.now() >= state.cooldownUntil && !state.running) {
    state.probing = true; state.cooldownUntil = 0; // 만료 후 첫 miss 작업 = 시험
  }
  const position = state.queue.indexOf(job.key);
  if (position * FETCH_GAP_MS * 4 > REQUEST_DEADLINE_MS) { finishJob(job, null); return send(res, 200, { mode: 'fallback', reason: 'busy' }); }
  const payload = await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; job.waiters = job.waiters.filter((w) => w !== cb); if (!job.waiters.length && !job.started) finishJob(job, null); resolve({ mode: 'fallback', reason: 'timeout' }); } }, REQUEST_DEADLINE_MS);
    const cb = (p) => { if (!done) { done = true; clearTimeout(timer); resolve(p); } };
    job.waiters.push(cb);
    pump();
  });
  if (!payload) return send(res, 200, { mode: 'fallback', reason: 'timeout' });
  if (payload.mode === 'fallback') return send(res, 200, payload);
  return send(res, 200, await buildResponse(payload.facts, asOf, position));
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/check') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => handleCheck(req, res, body).catch((e) => send(res, 500, { mode: 'fallback', reason: 'error', detail: String(e.message) })));
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, 'method not allowed', 'text/plain');
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`place-check http://localhost:${PORT}`));
}

module.exports = { REFRESH_MIN_MS, createServer, state, handleCheck, buildResponse, collect, enqueue, pump, startCooldown, readCache, writeCache, CACHE_DIR };
