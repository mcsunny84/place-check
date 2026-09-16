'use strict';
// 플레이스 체크 서버 — 06번 §3 큐·캐시·쿨다운. 외부 패키지 0.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
// .env (선택): KEY=VALUE 줄만, 이미 있는 process.env는 덮어쓰지 않음 — 모듈 require 전에 읽어야 REVIEW_MODEL이 적용됨
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env 없음 */ }
const { parsePlaceUrl } = require('./lib/url-parse');
const P = require('./lib/place-parse');
const { factsToAnswers } = require('./lib/facts-to-answers');
const S = require('./lib/place-scoring');
const K = require('./lib/keyword');
const D = require('./lib/draft');
const R = require('./lib/review-insight');
const KL = require('./lib/keyword-llm');
const DA = require('./lib/draft-analysis');
const CP = require('./lib/coupons');
const AD = require('./lib/naver-searchad');

const PORT = Number(process.env.PORT) || 8090;
const PUBLIC = path.join(__dirname, 'public');
const LIB = path.join(__dirname, 'lib');
const CACHE_DIR = process.env.PLACE_CACHE_DIR || path.join(__dirname, 'data', 'cache');
const STATS_FILE = process.env.PLACE_STATS_FILE || path.join(__dirname, 'data', 'stats', 'coupons.jsonl');
const CACHE_TTL_MS = 24 * 3600 * 1000;
const REFRESH_MIN_MS = 10 * 60 * 1000; // '다시 읽어오기'는 마지막 수집 후 10분 지나야 허용
const FETCH_GAP_MS = 1500;
const FETCH_TIMEOUT_MS = 8000;
const REQUEST_DEADLINE_MS = 90 * 1000;
const QUEUE_MAX = 200;
const COOLDOWN_MS = 30 * 60 * 1000;
const IP_LIMIT = 3; // 새 수집 작업 / 60초
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const TABS = ['review/visitor', 'feed']; // 홈에 상세설명·사진 수·찾아오는 길까지 있어(07번) 정보·사진 탭 불필요
const BUDGET = 11; // 홈 + 탭 2 + 리뷰 GraphQL 최대 6페이지 + 재시도·단축 URL 여유 2
const REVIEW_DAYS = 180;       // 리뷰 수집 창(최근 6개월)
const REVIEW_PAGES_MAX = 6;    // 50건 × 6 = 최대 300건 (그 이상은 창을 앞당겨 표시)
const GQL_URL = 'https://pcmap-api.place.naver.com/graphql';
const GQL_REVIEWS = 'query getVisitorReviews($input: VisitorReviewsInput) { visitorReviews(input: $input) { total items { id rating body visited created cursor reply { body created } votedKeywords { name } visitCategories { keywords { name } } } } }';

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
const HITS_FILE = path.join(path.dirname(STATS_FILE), 'hits.json');

// 일별 이용 집계(개인정보 없음): 페이지 열람·검사 요청·캐시 hit·폴백 사유, 방문자는 IP 해시 앞 10자로 하루 단위 유일 수만
function bump(kind, ip) {
  try {
    let h = {}; try { h = JSON.parse(fs.readFileSync(HITS_FILE, 'utf8')); } catch { /* 없음 */ }
    const day = kstDate(state.now());
    const d = h[day] = h[day] || { views: 0, checks: 0, cache: 0, fallback: {}, visitors: [] };
    if (kind === 'views') d.views += 1;
    else if (kind === 'checks') d.checks += 1;
    else if (kind === 'cache') d.cache += 1;
    else if (kind.startsWith('fallback:')) { const r = kind.slice(9); d.fallback[r] = (d.fallback[r] || 0) + 1; }
    if (ip) { const id = require('node:crypto').createHash('sha256').update(String(ip)).digest('hex').slice(0, 10); if (!d.visitors.includes(id)) d.visitors.push(id); }
    fs.writeFileSync(HITS_FILE, JSON.stringify(h));
  } catch { /* 집계 실패 무시 */ }
}

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
  llmKeywords: undefined,  // keyword-llm 주입용(동일 규칙)
  llmDescription: undefined, // draft-analysis 주입용
  fetchAd: undefined,        // 검색광고 API fetch 주입(테스트)
  adEnv: undefined,          // 검색광고 자격증명 env 주입(테스트)
  now: () => Date.now(),
  analyses: new Map(),       // `${placeId}:${fetched_at}` -> buildResponse Promise (같은 수집분의 동시 요청은 AI 분석 1회 공유)
};

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const cachePath = (id) => path.join(CACHE_DIR, `${id}.json`);

const CACHE_SCHEMA = 2; // facts 구조가 바뀌면 올린다(구 캐시 무시) — 2: coupons 필드 추가
function readCache(placeId, maxAge = CACHE_TTL_MS) {
  try {
    const j = JSON.parse(fs.readFileSync(cachePath(placeId), 'utf8'));
    if (j._schema !== CACHE_SCHEMA) return null;
    const age = state.now() - Date.parse(j.fetched_at);
    if (age >= 0 && age < maxAge) return j;
  } catch { /* miss */ }
  return null;
}
function writeCache(placeId, facts) {
  const tmp = cachePath(placeId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ ...facts, _schema: CACHE_SCHEMA }));
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
  if (state.ipLog.size > 1000) for (const [k, a] of state.ipLog) if (!a.some((x) => t - x < 60_000)) state.ipLog.delete(k); // 만료 IP 정리
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

// pcmap 내부 GraphQL(방문자 리뷰 페이지네이션, 07번 4차 실측: size≤50, after=마지막 cursor)
async function fetchReviewsPage({ placeId, type, after }) {
  await gapWait();
  const input = { businessId: placeId, businessType: type, item: '0', size: 50, includeContent: true, getReactions: false, getTrailer: false, getUserStats: false, includeReceiptPhotos: false, isPhotoUsed: false, cidList: [] };
  if (after) input.after = after;
  const res = await state.fetchImpl(GQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9', referer: `https://pcmap.place.naver.com/${type}/${placeId}/review/visitor`, origin: 'https://pcmap.place.naver.com' },
    body: JSON.stringify([{ operationName: 'getVisitorReviews', variables: { input }, query: GQL_REVIEWS }]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new Blocked('429');
  const text = await res.text();
  if (/보안 확인|자동 입력 방지|captcha/i.test(text) && !text.startsWith('[')) throw new Blocked('captcha'); // GraphQL이 캡차 HTML을 주면 서버 공통 쿨다운
  let j; try { j = JSON.parse(text); } catch { return null; }
  const v = j && j[0] && j[0].data && j[0].data.visitorReviews;
  return v && Array.isArray(v.items) ? v.items : null;
}

// 쿠폰 현황(GraphQL getUnifiedCoupons) — 1회. 실패는 missing.
async function fetchCoupons({ placeId, type }) {
  await gapWait();
  const res = await state.fetchImpl(GQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9', referer: `https://pcmap.place.naver.com/${type}/${placeId}/home`, origin: 'https://pcmap.place.naver.com' },
    body: JSON.stringify([{ operationName: 'getUnifiedCoupons', variables: { input: { businessId: placeId } }, query: CP.GQL_COUPONS }]),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new Blocked('429');
  const text = await res.text();
  if (/보안 확인|자동 입력 방지|captcha/i.test(text) && !text.startsWith('[')) throw new Blocked('captcha');
  let j; try { j = JSON.parse(text); } catch { return null; }
  const uc = j && j[0] && j[0].data && j[0].data.unifiedCoupons;
  return CP.normalizeCoupons(uc);
}

// 최근 REVIEW_DAYS일 리뷰를 커서로 모은다. 예산 내에서만, 실패는 조용히 중단(SSR 20건이 폴백).
async function collectReviews(job, placeId, type, facts, budgetRef) {
  const now = new Date(state.now());
  const cutoff = kstDate(now.getTime() - REVIEW_DAYS * 86400000);
  const all = [];
  let after = null, complete = false; // 정상 종결(창 끝·마지막 페이지)일 때만 true — 타임아웃·예산·커서 이상은 미완료
  const seen = new Set();
  for (let page = 0; page < REVIEW_PAGES_MAX && budgetRef.n > 0; page++) {
    budgetRef.n -= 1;
    let items;
    try { items = await fetchReviewsPage({ placeId, type, after }); }
    catch (e) { if (e instanceof Blocked) throw e; break; }
    if (!items) break;
    if (!items.length) { complete = true; break; }
    const norm = items.map((it) => P.normalizeReview(it, now)).filter(Boolean);
    if (!norm.length) break;
    all.push(...norm);
    const oldest = norm.map((r) => r.visited || r.created).filter(Boolean).sort()[0];
    if ((oldest && oldest < cutoff) || items.length < 50) { complete = true; break; }
    after = norm[norm.length - 1].cursor;
    if (!after || seen.has(after)) break;
    seen.add(after);
  }
  if (!all.length) return facts;
  const ssr = facts.reviews && facts.reviews.status === 'value' ? facts.reviews.value : [];
  const latestAny = P.dedupeReviews([...all, ...ssr]).map((r) => r.visited || r.created).filter(Boolean).sort().pop() || null; // 창 밖이어도 D1(최근 리뷰일)용으로 보존
  const merged = P.dedupeReviews([...all, ...ssr]).filter((r) => { const d = r.visited || r.created; return !d || d >= cutoff; });
  merged.sort((a, b) => String(b.visited || b.created || '').localeCompare(String(a.visited || a.created || '')));
  const oldest = merged.map((r) => r.visited || r.created).filter(Boolean).sort()[0] || cutoff;
  // 상한에 걸리면 실제 수집된 가장 오래된 날짜를 창 시작으로 표시(6개월을 다 못 채웠다는 사실을 숨기지 않음)
  return { ...facts, reviews: { status: 'value', value: merged }, latestReviewDate: latestAny ? { status: 'value', value: latestAny } : { status: 'missing' }, reviewWindow: { status: 'value', value: { days: REVIEW_DAYS, from: complete ? cutoff : (oldest > cutoff ? oldest : cutoff), fetched: P.dedupeReviews(all).length, complete } } };
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
  const budgetRef = { n: budget };
  try { facts = await collectReviews(job, placeId, type, facts, budgetRef); } catch (e) { if (e instanceof Blocked) throw e; }
  if (budgetRef.n > 0) {
    budgetRef.n -= 1;
    try { const c = await fetchCoupons({ placeId, type }); facts = { ...facts, coupons: c ? { status: 'value', value: c } : { status: 'missing' } }; }
    catch (e) { if (e instanceof Blocked) throw e; facts = { ...facts, coupons: { status: 'missing' } }; }
  } else facts = { ...facts, coupons: { status: 'missing' } };
  facts = { ...facts, fresh: true }; // 방금 수집(캐시 아님) 표시 — 통계 기록용
  writeCache(placeId, { ...facts, fresh: undefined });
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
// 같은 매장·같은 수집분의 동시 요청(버튼 연타, 합류 대기자)은 분석 1회를 공유 — AI 중복 호출·캐시 경쟁·통계 중복 방지
function buildResponse(facts, asOf, queuedPosition) {
  const v = (o) => (o && o.status === 'value' ? o.value : null);
  const key = `${v(facts.placeId)}:${facts.fetched_at}:${asOf}`;
  let p = state.analyses.get(key);
  if (!p) {
    p = buildResponseUncached(facts, asOf, queuedPosition).finally(() => state.analyses.delete(key));
    state.analyses.set(key, p);
  }
  return p.then((out) => ({ ...out, queued_position: queuedPosition }));
}
async function buildResponseUncached(facts, asOf, queuedPosition) {
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
  const reviewMenus = ((v(facts.reviewStats) || {}).menus || []).slice(0, 5).map((m) => m.name).filter((n) => n && n.length >= 2 && !/^(고기|맥주|생맥주|술|밥|물|음식)$/.test(n));
  const kctx = { name: v(facts.name), district, station, category: v(facts.category) || '', menus: kwMenus, reviewMenus };
  const keywords = {
    current: existing,
    diagnosis: K.diagnoseKeywords(existing, kctx),
    recommendations: K.recommendKeywords({ district, station, categoryNorm: cat.norm, suffix: cat.suffix, menus: kwMenus, reviewMenus, situations, existing }),
    llm: null,
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
    accessor: v(facts.road) || undefined, // 찾아오는 길(base.road) — accessor는 업주 정보라 오매핑(07번)
  });
  // 상세설명: 현재 글 진단 → 빠진 것만 제안
  const descText = v(facts.description) || '';
  const dctx = { district, station, categoryNorm: cat.norm, reviewMenus, existing, booking, phone: v(facts.virtualPhone) || v(facts.phone) || undefined };
  const descAnalysis = DA.analyzeDescription(descText, facts, dctx);

  // LLM 3종(키워드·상세설명·리뷰)은 병렬 호출, 매장당 1회 후 facts와 함께 캐시(24h) — 캐시 hit마다 재호출·재과금 방지
  const cachedKw = facts.keywords_llm !== undefined, cachedDesc = facts.description_llm !== undefined, cachedIns = facts.insight_llm !== undefined;
  const [kwLLM, descLLM, insight] = await Promise.all([
    cachedKw ? facts.keywords_llm : KL.recommendKeywordsLLM(facts, { station, existing, blogTitles: v(facts.blogTitles) || [] }, { llm: state.llmKeywords }),
    cachedDesc ? facts.description_llm : DA.reviseDescriptionLLM(descText, facts, dctx, descAnalysis, { llm: state.llmDescription }),
    cachedIns ? R.buildInsight(facts, { asOf, llm: async () => facts.insight_llm }) : R.buildInsight(facts, { asOf, llm: state.llm }),
  ]);
  keywords.llm = kwLLM;
  const coupons = CP.couponInsight(facts);
  if (facts.fresh) {
    const line = CP.statsLine(facts, { district, score: result.score, now: state.now() });
    if (line) { try { fs.appendFileSync(STATS_FILE, JSON.stringify(line) + '\n'); } catch { /* 통계 실패 무시 */ } }
  }
  // 월 검색수(네이버 검색광고 키워드도구) — 라이선스 3종이 .env에 있을 때만. 현재+AI+규칙 상위 후보 한 번에, 매장당 1회 캐시.
  let volumes = facts.keywords_volume !== undefined ? facts.keywords_volume : undefined;
  const wantVol = [...existing, ...((kwLLM && kwLLM.keywords) || []).map((k) => k.keyword), ...keywords.recommendations.map((r) => r.keyword)];
  if (volumes === undefined) {
    try { volumes = await AD.getKeywordVolumes(wantVol, { fetchImpl: state.fetchAd || state.fetchImpl, env: state.adEnv || process.env }); }
    catch (e) { console.error('[searchad]', (e && e.message || '').slice(0, 200)); volumes = null; }
  }
  keywords.volumes = volumes;
  if (volumes) {
    const vol = (k) => (volumes[k] && volumes[k].total != null ? volumes[k].total : null);
    keywords.diagnosis = keywords.diagnosis.map((d) => ({ ...d, volume: vol(d.keyword) }));
    keywords.recommendations = keywords.recommendations.map((r) => ({ ...r, volume: vol(r.keyword) }));
    if (kwLLM && kwLLM.keywords) { kwLLM.keywords = kwLLM.keywords.map((k) => ({ ...k, volume: vol(k.keyword) })).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1)); }
  }
  if (!(cachedKw && cachedDesc && cachedIns && facts.keywords_volume !== undefined)) {
    const pid = v(facts.placeId);
    // null(키 없음·실패)은 캐시하지 않는다(undefined → JSON에서 빠짐) — 키를 나중에 넣으면 다음 요청에서 다시 시도
    if (pid) {
      try {
        const ex = readCache(pid) || facts;
        // 같은 수집분에만 붙이고(새로 읽은 facts에 옛 분석 금지), 이번에 실패한 필드는 기존 성공값을 지우지 않는다
        if (ex.fetched_at === facts.fetched_at) writeCache(pid, { ...ex, keywords_llm: kwLLM || ex.keywords_llm || undefined, keywords_volume: volumes || ex.keywords_volume || undefined, description_llm: descLLM || ex.description_llm || undefined, insight_llm: (insight && insight.llm) || ex.insight_llm || undefined });
      } catch { /* 캐시 실패 무시 */ }
    }
  }
  return {
    mode: 'auto', as_of: asOf, queued_position: queuedPosition, insight,
    place: { id: v(facts.placeId), name: v(facts.name), category: v(facts.category), address: v(facts.roadAddress), district, station, fetched_at: facts.fetched_at },
    answers, auto, result, todos: S.pickTodos(result), supplement: S.pickSupplement(result), keywords, draft,
    description: { text: descText, analysis: descAnalysis, llm: descLLM },
    coupons,
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
  if (p === '/index.html') bump('views', (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim());
  const file = p.startsWith('/lib/') ? path.join(LIB, p.slice(5)) : path.join(PUBLIC, p);
  if (!file.startsWith(PUBLIC) && !file.startsWith(LIB)) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    const ext = path.extname(file);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300' }); // 화면 갱신이 폰에 바로 반영되도록
    res.end(buf);
  });
}

async function handleCheck(req, res, body) {
  let input;
  try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { mode: 'fallback', reason: 'bad_request' }); }
  const parsed = parsePlaceUrl(String(input.url || ''));
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  bump('checks', ip);
  if (!parsed.ok) { bump('fallback:' + parsed.reason); return send(res, 200, { mode: 'fallback', reason: parsed.reason }); }
  const asOf = kstDate(state.now());
  const refresh = input.refresh === true;
  // 캐시 hit — 쿨다운·IP 한도 무관. refresh면 10분 이내 수집분만 재사용(그보다 오래됐으면 새로 읽음)
  if (!parsed.needsResolve) {
    const cached = readCache(parsed.placeId, refresh ? REFRESH_MIN_MS : CACHE_TTL_MS);
    if (cached) { bump('cache'); const out = await buildResponse(cached, asOf, 0); out.cache = { hit: true, refresh_denied: refresh }; return send(res, 200, out); }
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
  if (!payload) { bump('fallback:timeout'); return send(res, 200, { mode: 'fallback', reason: 'timeout' }); }
  if (payload.mode === 'fallback') { bump('fallback:' + payload.reason); return send(res, 200, payload); }
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
    if (req.method === 'GET' && req.url.startsWith('/api/stats/coupons')) {
      const token = new URL(req.url, 'http://x').searchParams.get('token');
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) return send(res, 404, 'not found', 'text/plain');
      let lines = [];
      try { lines = fs.readFileSync(STATS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }); } catch { /* 없음 */ }
      let hits = {}; try { hits = JSON.parse(fs.readFileSync(HITS_FILE, 'utf8')); } catch { /* 없음 */ }
      const days = {};
      for (const [day, d] of Object.entries(hits)) days[day] = { views: d.views, checks: d.checks, cache: d.cache, visitors: (d.visitors || []).length, fallback: d.fallback, fresh: 0 };
      const seen = new Set();
      for (const l of lines.filter(Boolean)) { const day = String(l.ts || '').slice(0, 10); if (!seen.has(l.placeId)) { seen.add(l.placeId); days[day] = days[day] || { views: 0, checks: 0, cache: 0, visitors: 0, fallback: {}, fresh: 0 }; days[day].fresh += 1; } }
      const recent = lines.filter(Boolean).slice(-200).reverse().map((l) => ({ ts: l.ts, name: l.name, district: l.district, category: l.category, score: l.score, reviews: l.visitorReviewsTotal, coupons: l.couponCount, notify: l.hasNotification, placeId: l.placeId }));
      return send(res, 200, { file: STATS_FILE, records: lines.length, ...CP.aggregate(lines), days, recent });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, 'method not allowed', 'text/plain');
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`place-check http://localhost:${PORT}`));
}

module.exports = { REFRESH_MIN_MS, createServer, state, handleCheck, buildResponse, collect, enqueue, pump, startCooldown, readCache, writeCache, CACHE_DIR };
