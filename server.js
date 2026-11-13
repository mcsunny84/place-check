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
const V2 = require('./lib/place-score-v2');
const RK = require('./lib/rank-check');
const CP = require('./lib/coupons');
const AD = require('./lib/naver-searchad');
const U = require('./lib/usage');
const PS = require('./lib/persona');
const ST = require('./lib/persona-store');

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
const ANSWERS_FILE = path.join(path.dirname(STATS_FILE), 'answers.jsonl');
const ANSWERS_MAX_BYTES = 20 * 1024 * 1024; // ponytail: 넘으면 저장 중단, 회전은 실제로 찰 때 추가
const ANSWER_IP_LIMIT = 20; // 저장 / 60초
const LEADS_FILE = path.join(path.dirname(STATS_FILE), 'leads.jsonl');       // 상담 신청(이름·전화·이메일) — 관리자 전용
const REPORTS_DIR = path.join(path.dirname(STATS_FILE), 'reports');          // 결과 스냅샷(공유 링크 /r/<token>)
const LEAD_IP_LIMIT = 5; // 신청 / 60초
const YN = ['yes', 'no'];
const ANSWER_ENUM = { A1: YN, A2: ['all', 'some', 'no'], A3: ['yes', 'no', 'na'], A4: YN, B3: ['price', 'menu_only', 'none'], B4: YN, B7: YN, C1: ['on', 'off', 'na'], C2: YN, C3: YN, C4: YN, D3: ['clean', 'flagged'] };
const ANSWER_NUM = { B1: 9999, B2: 5, B5: 9999 };
const ANSWER_DATE = ['B6', 'D1', 'D2'];

// 자유 입력이 파일에 들어가지 않도록 허용 항목·값만 통과(개인정보 차단). 형식이 틀린 항목은 버린다.
function cleanAnswers(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, values] of Object.entries(ANSWER_ENUM)) if (values.includes(raw[id])) out[id] = raw[id];
  for (const [id, max] of Object.entries(ANSWER_NUM)) if (/^\d{1,4}$/.test(String(raw[id])) && Number(raw[id]) <= max) out[id] = Number(raw[id]);
  for (const id of ANSWER_DATE) if (raw[id] === 'none' || /^\d{4}-\d{2}-\d{2}$/.test(String(raw[id]))) out[id] = raw[id];
  return out;
}

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
  answerIpLog: new Map(), // 답변 저장용(검사 한도와 분리)
  leadIpLog: new Map(),   // 상담 신청용
  fetchImpl: globalThis.fetch,
  llm: undefined,          // review-insight LLM 호출 함수(테스트 주입); undefined = ANTHROPIC_API_KEY 있으면 실제 호출
  llmKeywords: undefined,  // keyword-llm 주입용(동일 규칙)
  llmDescription: undefined, // draft-analysis 주입용
  fetchAd: undefined,        // 검색광고 API fetch 주입(테스트)
  adEnv: undefined,          // 검색광고 자격증명 env 주입(테스트)
  now: () => Date.now(),
  llmPersona: undefined,     // 손님 카드 AI 호출 주입(테스트). undefined = ANTHROPIC_API_KEY 있으면 실제 호출, null = 호출 안 함
  personaJobs: new Map(),    // placeId -> 카드 분석 Promise(같은 매장 동시 요청 합류)
  personaExtraJobs: new Map(), // placeId -> 추가 분석 Promise
  personaFailUntil: new Map(), // placeId -> 이 시각까지 재시도 없이 failed
  personaRunning: 0, personaWaiters: [], // AI 동시 실행 2건 제한
  codeVerified: new Set(),     // 'ip|코드' — 이미 그 코드로 연 접속(오답 한도 중에도 폴링 허용)
  personaSearchLog: new Map(), // 가게 이름 검색 IP 한도
  personaSearchCache: new Map(), // 검색어 → { at, items } 1시간
  personaIpLog: new Map(),   // 새 분석 요청 IP 한도
  codeFailLog: new Map(),    // 틀린 코드 시도 IP 한도
  personaUnlockSeen: new Set(), // `${vid}:${placeId}` — 폴링이 unlock 기록을 부풀리지 않게
  analyses: new Map(),       // `${placeId}:${fetched_at}` -> buildResponse Promise (같은 수집분의 동시 요청은 AI 분석 1회 공유)
};

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const cachePath = (id) => path.join(CACHE_DIR, `${id}.json`);

const CACHE_SCHEMA = 4; // facts 구조가 바뀌면 올린다(구 캐시 무시) — 2: coupons 필드 추가, 3: placeMenus 메뉴·jibunAddress, 4: coordinate·placeType(순위 진단)
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

function ipAllowed(ip, log = state.ipLog, limit = IP_LIMIT) {
  const t = state.now();
  const arr = (log.get(ip) || []).filter((x) => t - x < 60_000);
  log.set(ip, arr);
  if (log.size > 1000) for (const [k, a] of log) if (!a.some((x) => t - x < 60_000)) log.delete(k); // 만료 IP 정리
  if (arr.length >= limit) return false;
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
  facts = { ...facts, fetched_at: new Date(state.now()).toISOString(), placeType: type }; // 서버 시계 기준(테스트 주입 가능). placeType: 순위 진단 목록 경로
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

// 키워드 순위: 네이버 지도 목록을 가게 좌표로 검색(fetchText — 간격·차단 감지 공용). 차단되면 서버 공통 쿨다운.
async function collectRanks(facts, keywords) {
  const v = (o) => (o && o.status === 'value' ? o.value : null);
  const pid = v(facts.placeId);
  const picks = pid ? RK.pickKeywords(keywords, 3) : [];
  const items = [];
  for (const k of picks) {
    if (inCooldown()) break;
    try {
      const r = await fetchText(RK.listUrl(facts.placeType, k.keyword, v(facts.coordinate)));
      const p = r.status === 200 ? RK.parseList(r.text, pid) : null;
      if (p) items.push({ ...k, ...p });
    } catch (e) { if (e instanceof Blocked) { startCooldown(); break; } }
  }
  return items.length ? { as_of: kstDate(state.now()), items } : null;
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
  const gu = K.extractDistrict(v(facts.roadAddress) || '');
  const district = K.extractDistrict(v(facts.jibunAddress) || '') || gu; // 동 우선(지번), 없으면 구
  const areas = gu && gu !== district ? [gu] : [];
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
  const kctx = { name: v(facts.name), district, areas, station, category: v(facts.category) || '', menus: kwMenus, reviewMenus };
  const keywords = {
    current: existing,
    diagnosis: K.diagnoseKeywords(existing, kctx),
    recommendations: K.recommendKeywords({ district, station, categoryNorm: cat.norm, suffix: cat.suffix, menus: kwMenus, reviewMenus, situations, existing }),
    llm: null,
  };
  const hours = v(facts.businessHours);
  const hoursLine = hours && hours.length ? DA.hoursLine(hours) || undefined : undefined; // '매일~매일'·요일별 다른 시간 뭉뚱그림 방지
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
  // 키워드 순위 진단 — 검색량 큰 키워드 최대 3개, 목록 1장씩. 매장당 1회 후 캐시(24h)
  const cachedRanks = facts.rank_check !== undefined;
  const ranks = cachedRanks ? facts.rank_check : await collectRanks(facts, keywords);
  // 점수 v2(품질 단계·사다리) — 검색량까지 나온 뒤 계산. v1 result는 보충 질문 재계산용으로 유지
  const resultV2 = V2.score(facts, { asOf, volumes: volumes || null });
  if (facts.fresh) {
    const line = CP.statsLine(facts, { district, score: result.score, scoreV2: resultV2.score, now: state.now() });
    if (line) { try { fs.appendFileSync(STATS_FILE, JSON.stringify(line) + '\n'); } catch { /* 통계 실패 무시 */ } }
  }
  if (!(cachedKw && cachedDesc && cachedIns && cachedRanks && facts.keywords_volume !== undefined)) {
    const pid = v(facts.placeId);
    // null(키 없음·실패)은 캐시하지 않는다(undefined → JSON에서 빠짐) — 키를 나중에 넣으면 다음 요청에서 다시 시도
    if (pid) {
      try {
        const ex = readCache(pid) || facts;
        // 같은 수집분에만 붙이고(새로 읽은 facts에 옛 분석 금지), 이번에 실패한 필드는 기존 성공값을 지우지 않는다
        if (ex.fetched_at === facts.fetched_at) writeCache(pid, { ...ex, keywords_llm: kwLLM || ex.keywords_llm || undefined, keywords_volume: volumes || ex.keywords_volume || undefined, description_llm: descLLM || ex.description_llm || undefined, insight_llm: (insight && insight.llm) || ex.insight_llm || undefined, rank_check: ranks || ex.rank_check || undefined });
      } catch { /* 캐시 실패 무시 */ }
    }
  }
  return {
    mode: 'auto', as_of: asOf, queued_position: queuedPosition, insight,
    place: { id: v(facts.placeId), name: v(facts.name), category: v(facts.category), address: v(facts.roadAddress), district, station, fetched_at: facts.fetched_at },
    answers, auto, result, result_v2: resultV2, todos: S.pickTodos(result), supplement: S.pickSupplement(result), keywords, draft,
    description: { text: descText, analysis: descAnalysis, llm: descLLM },
    coupons, ranks: ranks || null,
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
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css' : ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'application/octet-stream';
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
  const r = await obtainFacts(parsed, ip, { refresh });
  if (r.fallback) { if (r.counted) bump('fallback:' + r.fallback); return send(res, r.status, { mode: 'fallback', reason: r.fallback }); }
  const gate = checkCode(req, input.code); // 코드 확인은 수집 뒤에 — 결과가 없는데 오답 횟수만 쌓이지 않게
  let out;
  if (r.cacheHit) { bump('cache'); out = await buildResponse(r.facts, asOf, 0); out.cache = { hit: true, refresh_denied: refresh }; }
  else out = await buildResponse(r.facts, asOf, r.position);
  if (gate.ok) return send(res, 200, { ...out, locked: false });
  return send(res, 200, { ...lockResponse(out), code_error: gate.reason || null });
}

// ---------- 결과 잠금(오픈채팅 코드) ----------
// 코드 없이 보내는 것: 점수·영역·할 일 목록·순위 + 1번 할 일 샘플에 필요한 최소 자료. 나머지(키워드·상세설명·리뷰 분석·쿠폰·v1 체크)는 서버에서 뺀다.
// 코드는 손님 카드와 같은 PERSONA_CODES. 오답 한도도 같은 것을 쓴다.
function checkCode(req, code) {
  if (code == null || code === '') return { ok: false };
  if (typeof code !== 'string' || code.length > 20) return { ok: false, reason: 'bad_code' };
  const ip = clientIp(req); const fails = codeFails(ip);
  const ok = ST.codeOk(code); const vkey = `${ip}|${code.trim()}`;
  if (fails.length >= CODE_FAIL_LIMIT && !(ok && state.codeVerified.has(vkey))) return { ok: false, reason: 'slow_down' };
  if (!ok) { fails.push(state.now()); return { ok: false, reason: 'bad_code' }; }
  if (state.codeVerified.size > 5000) state.codeVerified.clear();
  state.codeVerified.add(vkey);
  return { ok: true };
}
function lockResponse(out) {
  const r2 = out.result_v2 || {}; const first = (r2.todos || [])[0]; const id = first && first.id;
  const lean = { mode: out.mode, as_of: out.as_of, queued_position: out.queued_position, cache: out.cache, place: out.place, result_v2: out.result_v2, ranks: out.ranks, locked: true };
  if (id === 'K1' && out.keywords) {
    const kw = out.keywords; const cur = kw.current || [];
    const cand = [...((kw.llm && kw.llm.keywords) || []), ...(kw.recommendations || [])].filter((k) => k && k.keyword && (k.volume || 0) >= 100 && !cur.includes(k.keyword));
    const uniq = [...new Map(cand.map((k) => [k.keyword.replace(/\s+/g, ''), k])).values()].slice(0, 2).map((k) => ({ keyword: k.keyword, volume: k.volume }));
    lean.keywords = { current: cur, diagnosis: (kw.diagnosis || []).map((x) => ({ keyword: x.keyword, labels: x.labels || [] })), llm: { keywords: uniq }, recommendations: [] };
  }
  if (id === 'R4' && out.insight && out.insight.strengths) lean.insight = { strengths: out.insight.strengths.slice(0, 1) };
  if ((id === 'F1' || id === 'F2') && out.coupons && out.coupons.coupons) lean.coupons = { coupons: out.coupons.coupons.slice(0, 1) };
  if (/^T[1-5]$/.test(id || '') && out.description) {
    const d = out.description; const add = (d.llm && d.llm.add && d.llm.add[0]) || (d.analysis && d.analysis.add && d.analysis.add[0]);
    if (add) lean.description = { llm: { add: [add] } };
  }
  return lean;
}

// 사실(facts) 확보: 캐시 → 쿨다운·시험 상태 → IP 한도 → 큐 합류·대기. /api/check와 손님 카드가 같이 쓴다.
// 반환: { facts, position, cacheHit } | { fallback, status, counted } — counted는 기존에 fallback 집계(bump)를 하던 갈래(대기 뒤 실패)만 true.
async function obtainFacts(parsed, ip, { refresh = false } = {}) {
  // 캐시 hit — 쿨다운·IP 한도 무관. refresh면 10분 이내 수집분만 재사용(그보다 오래됐으면 새로 읽음)
  if (!parsed.needsResolve) {
    const cached = readCache(parsed.placeId, refresh ? REFRESH_MIN_MS : CACHE_TTL_MS);
    if (cached) return { facts: cached, position: 0, cacheHit: true };
  }
  if (inCooldown()) return { fallback: 'cooldown', status: 200, counted: false };
  if (state.probing) {
    // 시험 중: 같은 작업 합류만 허용, 다른 miss는 폴백
    const key = parsed.needsResolve ? `s:${parsed.shortUrl}` : parsed.placeId;
    if (!state.jobs.has(key)) return { fallback: 'cooldown', status: 200, counted: false };
  }
  if (!ipAllowed(ip)) return { fallback: 'ip_limit', status: 429, counted: false };
  const job = enqueue({ ...parsed, refresh });
  if (!job) return { fallback: 'busy', status: 200, counted: false };
  if (state.cooldownUntil && !state.probing && state.now() >= state.cooldownUntil && !state.running) {
    state.probing = true; state.cooldownUntil = 0; // 만료 후 첫 miss 작업 = 시험
  }
  const position = state.queue.indexOf(job.key);
  if (position * FETCH_GAP_MS * 4 > REQUEST_DEADLINE_MS) { finishJob(job, null); return { fallback: 'busy', status: 200, counted: false }; }
  const payload = await new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; job.waiters = job.waiters.filter((w) => w !== cb); if (!job.waiters.length && !job.started) finishJob(job, null); resolve({ mode: 'fallback', reason: 'timeout' }); } }, REQUEST_DEADLINE_MS);
    const cb = (p) => { if (!done) { done = true; clearTimeout(timer); resolve(p); } };
    job.waiters.push(cb);
    pump();
  });
  if (!payload) return { fallback: 'timeout', status: 200, counted: true };
  if (payload.mode === 'fallback') return { fallback: payload.reason, status: 200, counted: true };
  return { facts: payload.facts, position, cacheHit: false };
}

// 사용자 직접 입력 답변 저장. 매장명·점수는 클라이언트 값을 믿지 않고 서버 캐시·채점으로 채운다.
function handleAnswers(req, res, body) {
  let input;
  try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false }); }
  const answers = cleanAnswers(input && input.answers);
  if (!Object.keys(answers).length) return send(res, 400, { ok: false });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!ipAllowed(ip, state.answerIpLog, ANSWER_IP_LIMIT)) return send(res, 429, { ok: false });
  const placeId = /^\d{1,20}$/.test(String(input.placeId)) ? String(input.placeId) : null;
  const facts = placeId && readCache(placeId);
  const asOf = kstDate(state.now());
  const auto = facts ? factsToAnswers(facts, { asOf }).answers : {};
  const r = S.computeScore({ ...auto, ...answers }, { asOf });
  const unscored = placeId && !facts; // 캐시 만료: 자동값 없이 채점하면 틀린 점수가 된다
  const line = { ts: new Date(state.now()).toISOString(), placeId, name: facts && facts.name && facts.name.status === 'value' ? facts.name.value : null, answers, score: !unscored && r.display === 'score' ? r.score : null, grade: unscored ? null : r.grade };
  try {
    let size = 0; try { size = fs.statSync(ANSWERS_FILE).size; } catch { /* 없음 */ }
    if (size >= ANSWERS_MAX_BYTES) return send(res, 507, { ok: false });
    fs.appendFileSync(ANSWERS_FILE, JSON.stringify(line) + '\n');
  } catch { return send(res, 500, { ok: false }); }
  send(res, 200, { ok: true });
}

// 결과 스냅샷 → 공유 링크. 클라이언트 JSON을 믿지 않고 서버 캐시로 다시 조립해 저장한다(캐시 만료면 실패).
async function makeReport(placeId, asOf) {
  const facts = readCache(placeId);
  if (!facts) return null;
  const out = await buildResponse(facts, asOf, 0);
  const token = require('node:crypto').randomBytes(8).toString('base64url');
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const snap = { ...out, cache: undefined, report: { token, created_at: new Date(state.now()).toISOString() } };
  fs.writeFileSync(path.join(REPORTS_DIR, token + '.json'), JSON.stringify(snap));
  return { token, score: out.result_v2 && out.result_v2.score, grade: out.result_v2 && out.result_v2.grade, name: out.place.name, category: out.place.category, district: out.place.district };
}
function readReport(token) {
  if (!/^[A-Za-z0-9_-]{8,16}$/.test(token)) return null;
  try { return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, token + '.json'), 'utf8')); } catch { return null; }
}
async function handleShare(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false }); }
  const placeId = /^\d{1,20}$/.test(String(input.placeId)) ? String(input.placeId) : null;
  if (!placeId) return send(res, 400, { ok: false, reason: 'bad_request' });
  const gate = checkCode(req, input.code); // 공유 리포트는 전체 결과라 코드가 있어야(잠금 우회 방지)
  if (!gate.ok) return send(res, 200, { ok: false, reason: gate.reason || 'locked' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!ipAllowed(ip, state.leadIpLog, LEAD_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'ip_limit' });
  const r = await makeReport(placeId, kstDate(state.now()));
  if (!r) return send(res, 200, { ok: false, reason: 'expired' });
  send(res, 200, { ok: true, token: r.token });
}
// 상담 신청: 이름·전화 필수, 이메일 선택. 개인정보는 leads.jsonl에만(관리자 토큰으로만 열람), 통계·캐시엔 안 섞음.
async function handleLead(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false }); }
  const name = String(input.name || '').trim().slice(0, 30);
  const phone = String(input.phone || '').replace(/[^0-9]/g, '');
  const email = String(input.email || '').trim().slice(0, 80);
  const placeId = /^\d{1,20}$/.test(String(input.placeId)) ? String(input.placeId) : null;
  if (!name || phone.length < 9 || phone.length > 11) return send(res, 400, { ok: false, reason: 'invalid' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { ok: false, reason: 'invalid_email' });
  if (input.consent !== true) return send(res, 400, { ok: false, reason: 'consent' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (!ipAllowed(ip, state.leadIpLog, LEAD_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'ip_limit' });
  const r = placeId ? await makeReport(placeId, kstDate(state.now())) : null;
  const line = { ts: new Date(state.now()).toISOString(), name, phone, email: email || null, placeId, store: r ? r.name : null, category: r ? r.category : null, district: r ? r.district : null, score: r ? r.score : null, grade: r ? r.grade : null, token: r ? r.token : null, memo: String(input.memo || '').trim().slice(0, 300) || null };
  try { fs.appendFileSync(LEADS_FILE, JSON.stringify(line) + '\n'); } catch { return send(res, 500, { ok: false }); }
  send(res, 200, { ok: true, token: r ? r.token : null });
}

// ---------- 손님 카드(/persona) ----------
const PERSONA_SLOTS = 2, PERSONA_WAIT_MAX = 20, PERSONA_FAIL_HOLD_MS = 60 * 1000, PERSONA_IP_LIMIT = 6, CODE_FAIL_LIMIT = 10, EXTRAS_STALE_MS = 120 * 1000, EXTRAS_TRIES_MAX = 2;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// 직접 연결은 소켓 주소. 같은 기계의 프록시를 거친 경우에만 전달 헤더를 믿는다(헤더 위조로 한도 우회 방지).
function clientIp(req) {
  const ra = (req.socket && req.socket.remoteAddress) || '';
  if (LOOPBACK.has(ra)) return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || ra;
  return ra;
}
const personaReason = (r) => (r === 'unsupported_url' ? 'unsupported' : r);
// AI 동시 실행 제한. 자리가 없고 대기 줄도 차면 null.
async function withPersonaSlot(fn) {
  if (state.personaRunning >= PERSONA_SLOTS) {
    if (state.personaWaiters.length >= PERSONA_WAIT_MAX) return null;
    await new Promise((r) => state.personaWaiters.push(r)); // 자리를 넘겨받음(카운트는 넘겨준 쪽 것을 그대로 씀)
  } else state.personaRunning += 1;
  try { return await fn(); }
  finally { const next = state.personaWaiters.shift(); if (next) next(); else state.personaRunning -= 1; }
}
function codeFails(ip) {
  const t = state.now();
  const a = (state.codeFailLog.get(ip) || []).filter((x) => t - x < 60_000);
  state.codeFailLog.set(ip, a);
  if (state.codeFailLog.size > 1000) for (const [k, x] of state.codeFailLog) if (!x.some((y) => t - y < 60_000)) state.codeFailLog.delete(k);
  return a;
}

function startExtras(placeId, facts, result) {
  if (state.personaExtraJobs.has(placeId)) return;
  const job = (async () => {
    let extras = null;
    try { extras = await withPersonaSlot(() => PS.analyzeExtras(facts, result.cards, { llm: state.llmPersona, now: state.now() })); } catch { extras = null; }
    const cur = ST.readResult(placeId, state.now()) || result;
    try { ST.writeResult(placeId, { ...cur, extras: extras || null, extras_status: extras ? 'ready' : 'failed' }, state.now()); } catch { /* 저장 실패: pending으로 남고 ensureExtras가 정리 */ }
  })().finally(() => state.personaExtraJobs.delete(placeId));
  state.personaExtraJobs.set(placeId, job);
}
// 추가 분석이 오래 pending이면(서버 재시작 등) 한 번 더 돌리거나 failed로 닫는다.
function ensureExtras(placeId, stored) {
  if (stored.status !== 'ok' || stored.extras_status !== 'pending' || state.personaExtraJobs.has(placeId)) return stored;
  if (state.now() - Date.parse(stored.extras_started_at || 0) <= EXTRAS_STALE_MS) return stored;
  const facts = readCache(placeId);
  const retry = !!facts && (stored.extras_tries || 1) < EXTRAS_TRIES_MAX;
  const next = retry ? { ...stored, extras_started_at: new Date(state.now()).toISOString(), extras_tries: (stored.extras_tries || 1) + 1 } : { ...stored, extras_status: 'failed' };
  let saved;
  try { saved = ST.writeResult(placeId, next, state.now()); } catch { return { ...stored, extras_status: 'failed' }; }
  if (retry) startExtras(placeId, facts, saved);
  return saved;
}

async function runPersona(placeId, facts, who) {
  const place = PS.placeMeta(facts);
  const out = await withPersonaSlot(() => PS.analyzeCards(facts, { llm: state.llmPersona, now: state.now() }));
  if (!out) return { status: 'busy' };
  if (out.status !== 'ok') { state.personaFailUntil.set(placeId, state.now() + PERSONA_FAIL_HOLD_MS); return { status: 'failed' }; }
  let saved;
  try { saved = ST.writeResult(placeId, { status: 'ok', place, confidence: out.confidence, review_count: out.review_count, cards: out.cards, extras: null, extras_status: 'pending', extras_started_at: new Date(state.now()).toISOString(), extras_tries: 1 }, state.now()); }
  catch { state.personaFailUntil.set(placeId, state.now() + PERSONA_FAIL_HOLD_MS); return { status: 'failed' }; }
  ST.logEvent({ type: 'analyze', placeId, ...place, reviews: out.review_count, cards: out.cards.map((c) => c.nickname), status: 'ok', ...who }, state.now());
  startExtras(placeId, facts, saved);
  return saved;
}

// 0단계: 가게 이름 → 고를 후보(네이버 지도 목록 1장). 주소를 몰라도 시작할 수 있게.
const SEARCH_IP_LIMIT = 10, SEARCH_TTL_MS = 60 * 60 * 1000, SEARCH_CACHE_MAX = 500, SEARCH_ITEMS = 8;
async function handlePersonaSearch(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, reason: 'bad_request' }); }
  const q = input && typeof input.q === 'string' ? input.q.replace(/\s+/g, ' ').trim() : '';
  if (/https?:\/\/|naver\.me|place\.naver|map\.naver/i.test(q)) return send(res, 200, { ok: false, reason: 'is_url' });
  if (q.length < 2) return send(res, 200, { ok: false, reason: 'too_short' });
  if (q.length > 40) return send(res, 200, { ok: false, reason: 'too_long' });
  const now = state.now(); const hit = state.personaSearchCache.get(q);
  if (hit && now - hit.at < SEARCH_TTL_MS) return send(res, 200, { ok: true, items: hit.items });
  if (inCooldown()) return send(res, 200, { ok: false, reason: 'cooldown' });
  if (!ipAllowed(clientIp(req), state.personaSearchLog, SEARCH_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'slow_down' });
  let items = null;
  try {
    const r = await fetchText(RK.listUrl('restaurant', q));
    items = r.status === 200 ? RK.parseSearch(r.text, SEARCH_ITEMS) : null;
  } catch (e) { if (e instanceof Blocked) { startCooldown(); return send(res, 200, { ok: false, reason: 'cooldown' }); } }
  if (!items) return send(res, 200, { ok: false, reason: 'unreadable' });
  if (state.personaSearchCache.size >= SEARCH_CACHE_MAX) state.personaSearchCache.clear();
  state.personaSearchCache.set(q, { at: now, items });
  send(res, 200, { ok: true, items });
}

// 1단계: 주소 → 매장 확인(수집). 보관된 결과가 있으면 수집 없이 바로.
async function handlePersonaCollect(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, reason: 'bad_request' }); }
  if (!input || typeof input !== 'object') return send(res, 400, { ok: false, reason: 'bad_request' });
  const parsed = parsePlaceUrl(String(input.url || ''));
  if (!parsed.ok) return send(res, 200, { ok: false, reason: personaReason(parsed.reason) });
  const now = state.now();
  if (!parsed.needsResolve) {
    const stored = ST.readResult(parsed.placeId, now);
    if (stored && stored.place) return send(res, 200, { ok: true, cached: true, placeId: parsed.placeId, name: stored.place.name, category: stored.place.category, district: stored.place.district, review_count: stored.review_count || 0, confidence: stored.confidence || null, peeks: [] });
  }
  const r = await obtainFacts(parsed, clientIp(req));
  if (r.fallback) return send(res, r.status, { ok: false, reason: personaReason(r.fallback) });
  const facts = r.facts; const place = PS.placeMeta(facts); const placeId = place.id || parsed.placeId;
  if (!placeId || !/^\d{1,20}$/.test(String(placeId))) return send(res, 200, { ok: false, reason: 'unreadable' });
  if (!PS.isFoodService(facts)) {
    ST.logEvent({ type: 'reject', placeId, ...place, reason: 'not_food', vid: input.vid, ch: input.ch }, now);
    return send(res, 200, { ok: false, reason: 'not_food', category: place.category });
  }
  if (!facts.reviews || facts.reviews.status !== 'value') return send(res, 200, { ok: false, reason: 'unreadable' });
  const n = PS.selectReviews(facts, now).length;
  send(res, 200, { ok: true, cached: !!ST.readResult(placeId, now), placeId: String(placeId), name: place.name, category: place.category, district: place.district, review_count: n, confidence: PS.confidence(n), peeks: PS.peeks(facts, now) });
}

// 2단계: 카드 분석. 보관 결과 → 합류 → 업종·리뷰 확인 → 예산 예약 → AI.
async function handlePersonaAnalyze(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { status: 'bad_request' }); }
  const placeId = input && /^\d{1,20}$/.test(String(input.placeId)) ? String(input.placeId) : null;
  if (!placeId) return send(res, 400, { status: 'bad_request' });
  const who = { vid: input.vid, ch: input.ch }; const now = state.now();
  const stored = ST.readResult(placeId, now);
  if (stored) {
    ST.logEvent({ type: 'view', placeId, ...(stored.place || {}), reviews: stored.review_count, status: stored.status, ...who }, now);
    return send(res, 200, PS.publicView(ensureExtras(placeId, stored), false));
  }
  let job = state.personaJobs.get(placeId);
  if (!job) {
    const facts = readCache(placeId);
    if (!facts) return send(res, 200, { status: 'expired' });
    const place = PS.placeMeta(facts);
    if (!PS.isFoodService(facts)) { ST.logEvent({ type: 'reject', placeId, ...place, reason: 'not_food', ...who }, now); return send(res, 200, { status: 'not_food' }); }
    if (!facts.reviews || facts.reviews.status !== 'value') return send(res, 200, { status: 'unreadable' });
    const n = PS.selectReviews(facts, now).length;
    if (PS.confidence(n) === 'too_few') {
      // 수집이 끝까지 됐거나 전체 리뷰가 원래 5건 미만일 때만 "부족"으로 보관한다(R2-09: 끊긴 수집을 7일 굳히지 않는다)
      const win = facts.reviewWindow && facts.reviewWindow.status === 'value' ? facts.reviewWindow.value : null;
      const stats = facts.reviewStats && facts.reviewStats.status === 'value' ? facts.reviewStats.value : null;
      const total = stats && Number.isFinite(stats.totalCount) ? stats.totalCount : null;
      if (!(win && win.complete === true) && !(total !== null && total < 5)) return send(res, 200, { status: 'unreadable' });
      const few = { status: 'too_few', place, confidence: 'too_few', review_count: n, cards: [] };
      try { ST.writeResult(placeId, few, now); } catch { /* 보관 실패는 무시(AI 비용 없음) */ }
      ST.logEvent({ type: 'analyze', placeId, ...place, reviews: n, cards: [], status: 'too_few', ...who }, now);
      return send(res, 200, PS.publicView(few, false));
    }
    if ((state.personaFailUntil.get(placeId) || 0) > now) return send(res, 200, { status: 'failed' });
    // 자리가 없으면 예산을 쓰기 전에 돌려보낸다(R2-01). 여기부터 runPersona의 자리 잡기까지 await 없음.
    if (state.personaRunning >= PERSONA_SLOTS && state.personaWaiters.length >= PERSONA_WAIT_MAX) return send(res, 200, { status: 'busy' });
    if (!ipAllowed(clientIp(req), state.personaIpLog, PERSONA_IP_LIMIT)) return send(res, 429, { status: 'slow_down' });
    if (!ST.reserve(now)) return send(res, 200, { status: 'closed' }); // 동기 예약 — 여기까지 await 없음
    job = runPersona(placeId, facts, who).finally(() => state.personaJobs.delete(placeId));
    state.personaJobs.set(placeId, job);
  }
  const result = await job;
  send(res, 200, result.status === 'ok' ? PS.publicView(result, false) : { status: result.status });
}

// 3단계: 코드로 열기. 틀린 시도만 센다(맞는 코드는 추가 분석을 기다리며 여러 번 불러도 된다).
function handlePersonaUnlock(req, res, body) {
  let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, reason: 'bad_request' }); }
  const placeId = input && /^\d{1,20}$/.test(String(input.placeId)) ? String(input.placeId) : null;
  if (!placeId) return send(res, 400, { ok: false, reason: 'bad_request' });
  const ip = clientIp(req); const fails = codeFails(ip); const now = state.now();
  // 오답 한도에 걸린 주소는 처음 넣는 코드를 맞아도 받지 않는다(R3-01: 0000~9999 훑기 방지).
  // 다만 그 주소에서 이미 그 코드로 연 적이 있으면 통과(R2-07: 열어 둔 사람의 폴링·공유 IP).
  const ok = ST.codeOk(input.code); const vkey = `${ip}|${String(input.code).trim()}`;
  if (fails.length >= CODE_FAIL_LIMIT && !(ok && state.codeVerified.has(vkey))) return send(res, 429, { ok: false, reason: 'slow_down' });
  if (!ok) { fails.push(now); return send(res, 200, { ok: false, reason: 'bad_code' }); }
  if (state.codeVerified.size > 5000) state.codeVerified.clear();
  state.codeVerified.add(vkey);
  let stored = ST.readResult(placeId, now);
  if (!stored) return send(res, 200, { ok: false, reason: 'expired' });
  stored = ensureExtras(placeId, stored);
  const vid = ST.cleanVid(input.vid); const seen = `${kstDate(now)}:${vid}:${placeId}`; // 날짜별로 한 번(R3-09)
  if (!state.personaUnlockSeen.has(seen)) {
    if (state.personaUnlockSeen.size > 5000) state.personaUnlockSeen.clear();
    state.personaUnlockSeen.add(seen);
    ST.logEvent({ type: 'unlock', placeId, ...(stored.place || {}), reviews: stored.review_count, vid, ch: input.ch }, now);
  }
  send(res, 200, { ok: true, ...PS.publicView(stored, true) });
}

function adminOk(req) {
  const token = new URL(req.url, 'http://x').searchParams.get('token');
  return !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN;
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'POST' && (req.url === '/api/check' || req.url === '/api/answers' || req.url === '/api/lead' || req.url === '/api/share')) {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        if (req.url === '/api/answers') return handleAnswers(req, res, body);
        if (req.url === '/api/lead') return handleLead(req, res, body).catch((e) => send(res, 500, { ok: false }));
        if (req.url === '/api/share') return handleShare(req, res, body).catch((e) => send(res, 500, { ok: false }));
        handleCheck(req, res, body).catch((e) => send(res, 500, { mode: 'fallback', reason: 'error', detail: String(e.message) }));
      });
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/persona/')) {
      const route = req.url.split('?')[0];
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        if (route === '/api/persona/search') return handlePersonaSearch(req, res, body).catch(() => send(res, 500, { ok: false, reason: 'error' }));
        if (route === '/api/persona/collect') return handlePersonaCollect(req, res, body).catch(() => send(res, 500, { ok: false, reason: 'error' }));
        if (route === '/api/persona/analyze') return handlePersonaAnalyze(req, res, body).catch(() => send(res, 500, { status: 'failed' }));
        if (route === '/api/persona/unlock') { try { return handlePersonaUnlock(req, res, body); } catch { return send(res, 500, { ok: false, reason: 'error' }); } }
        send(res, 404, { ok: false, reason: 'not_found' });
      });
      return;
    }
    if (req.method === 'GET' && req.url.split('?')[0] === '/persona') { req.url = '/persona.html'; return serveStatic(req, res); }
    if (req.method === 'GET' && req.url.startsWith('/api/stats/persona')) {
      if (!adminOk(req)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, { ...ST.aggregate(), llm: U.aggregate().byKind });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/report/')) {
      const snap = readReport(req.url.slice('/api/report/'.length).split('?')[0]);
      return snap ? send(res, 200, snap) : send(res, 404, { ok: false, reason: 'not_found' });
    }
    if (req.method === 'GET' && req.url.startsWith('/r/')) { req.url = '/index.html'; return serveStatic(req, res); } // 리포트 모드(클라이언트가 경로로 판단)
    if (req.method === 'GET' && req.url.startsWith('/api/stats/leads')) {
      if (!adminOk(req)) return send(res, 404, 'not found', 'text/plain');
      let lines = [];
      try { lines = fs.readFileSync(LEADS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* 없음 */ }
      return send(res, 200, { records: lines.length, recent: lines.slice(-300).reverse() });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/stats/answers')) {
      if (!adminOk(req)) return send(res, 404, 'not found', 'text/plain');
      let lines = [];
      try { lines = fs.readFileSync(ANSWERS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* 없음 */ }
      return send(res, 200, { records: lines.length, recent: lines.slice(-200).reverse() });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/stats/coupons')) {
      if (!adminOk(req)) return send(res, 404, 'not found', 'text/plain');
      let lines = [];
      try { lines = fs.readFileSync(STATS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }); } catch { /* 없음 */ }
      let hits = {}; try { hits = JSON.parse(fs.readFileSync(HITS_FILE, 'utf8')); } catch { /* 없음 */ }
      const days = {};
      for (const [day, d] of Object.entries(hits)) days[day] = { views: d.views, checks: d.checks, cache: d.cache, visitors: (d.visitors || []).length, fallback: d.fallback, fresh: 0 };
      const seen = new Set();
      for (const l of lines.filter(Boolean)) { const day = String(l.ts || '').slice(0, 10); if (!seen.has(l.placeId)) { seen.add(l.placeId); days[day] = days[day] || { views: 0, checks: 0, cache: 0, visitors: 0, fallback: {}, fresh: 0 }; days[day].fresh += 1; } }
      const recent = lines.filter(Boolean).slice(-200).reverse().map((l) => ({ ts: l.ts, name: l.name, district: l.district, category: l.category, score: l.score, reviews: l.visitorReviewsTotal, coupons: l.couponCount, notify: l.hasNotification, placeId: l.placeId }));
      return send(res, 200, { file: STATS_FILE, records: lines.length, ...CP.aggregate(lines), days, recent, llm: U.aggregate() });
    }
    if (req.method === 'GET') return serveStatic(req, res);
    send(res, 405, 'method not allowed', 'text/plain');
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => console.log(`place-check http://localhost:${PORT}`));
}

module.exports = { REFRESH_MIN_MS, createServer, state, handleCheck, obtainFacts, handlePersonaSearch, handlePersonaCollect, handlePersonaAnalyze, handlePersonaUnlock, clientIp, buildResponse, collect, enqueue, pump, startCooldown, readCache, writeCache, CACHE_DIR };
