'use strict';
// 큐·캐시·쿨다운 전이 회귀 (06번 §3·§5) — fake fetch, 주입 시계, 네트워크 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PLACE_CACHE_DIR = path.join(require('node:os').tmpdir(), 'place-check-test-cache');
process.env.PLACE_STATS_FILE = path.join(require('node:os').tmpdir(), 'place-check-test-cache', 'coupons.jsonl');
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server');

const FX = path.join(__dirname, 'fixtures');
const home = fs.readFileSync(path.join(FX, 'kise-anguk-home.html'), 'utf8');
const feed = fs.readFileSync(path.join(FX, 'kise-anguk-feed.html'), 'utf8');
const photo = fs.readFileSync(path.join(FX, 'kise-anguk-photo.html'), 'utf8');
const info = fs.readFileSync(path.join(FX, 'kise-anguk-information.html'), 'utf8');
const rvis = fs.readFileSync(path.join(FX, 'kise-anguk-review-visitor.html'), 'utf8');
srv.state.llm = null; srv.state.llmKeywords = null; srv.state.llmDescription = null; // 테스트에서 LLM 호출 금지
srv.state.adEnv = {}; // 검색광고 키가 .env에 있어도 테스트는 미사용

function resetState({ now = 1_800_000_000_000 } = {}) {
  const s = srv.state;
  s.cooldownUntil = 0; s.probing = false; s.jobs.clear(); s.queue.length = 0; s.running = false; s.lastFetchStart = 0; s.ipLog.clear();
  let t = now; s.now = () => t; s.tick = (ms) => { t += ms; };
  for (const f of fs.readdirSync(srv.CACHE_DIR)) fs.unlinkSync(path.join(srv.CACHE_DIR, f));
  return s;
}
function fakeFetch(plan) {
  // plan: (url) => {status, text} | Error
  const calls = [];
  srv.state.fetchImpl = async (url, opts) => {
    calls.push(url);
    const r = plan(url, calls.length, opts);
    if (r instanceof Error) throw r;
    return { status: r.status, url: r.url || url, text: async () => r.text };
  };
  return calls;
}
const GQL_EMPTY = JSON.stringify([{ data: { visitorReviews: { total: 0, items: [] } } }]);
const GQL_COUPONS = JSON.stringify([{ data: { unifiedCoupons: { total: 1, coupons: [{ promotionTitle: '알림받기 쿠폰', conditionType: 'PLACE_BENEFIT_NOTIFICATION_SUBSCRIBED', title: '음료 1잔', type: 'gift', status: 'download', expiredPeriodInfo: '', usedConditionInfos: [] }], memberships: [] } } }]);
const isCouponReq = (opts) => !!(opts && opts.body && String(opts.body).includes('getUnifiedCoupons'));
const okPlan = (url, n, opts) => /graphql/.test(url) ? { status: 200, text: isCouponReq(opts) ? GQL_COUPONS : GQL_EMPTY } : /\/home$/.test(url) ? { status: 200, text: home } : /\/review\/visitor$/.test(url) ? { status: 200, text: rvis } : /\/information$/.test(url) ? { status: 200, text: info } : /\/feed$/.test(url) ? { status: 200, text: feed } : /\/photo$/.test(url) ? { status: 200, text: photo } : { status: 404, text: '' };

function req(url, ip = '1.1.1.1', extra = {}) {
  return new Promise((resolve) => {
    const res = { writeHead(code) { this.code = code; }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }); } };
    srv.handleCheck({ headers: { 'x-forwarded-for': ip }, socket: {} }, res, JSON.stringify({ url, ...extra }));
  });
}
const URL1 = 'https://m.place.naver.com/restaurant/2086785604/home';

test('정상: 홈+2탭+리뷰 GraphQL 1회+쿠폰 1회 fetch, 결과 auto, 캐시 저장', async () => {
  resetState(); const calls = fakeFetch(okPlan);
  srv.state.lastFetchStart = 0; // 간격 대기 0
  const t0 = Date.now();
  const r = await req(URL1);
  assert.equal(r.body.mode, 'auto');
  assert.equal(r.body.place.name, '키세카츠 안국역점');
  assert.equal(calls.length, 5);
  assert.ok(srv.readCache('2086785604'));
  assert.ok(Date.now() - t0 >= 4 * 1500 - 50, '요청 시작 간격 1.5초 적용');
  assert.equal(r.body.coupons.count, 1); assert.equal(r.body.coupons.hasNotification, true); assert.equal(r.body.answers.C3, 'yes');
  assert.equal(r.body.answers.A4, 'yes', '찾아오는 길 = base.road');
  assert.equal(r.body.answers.B5, 23, '사진 수는 홈에서');
  assert.equal(r.body.answers.D1, '2026-09-13', '리뷰 탭에서 D1 자동');
  assert.ok(r.body.insight && r.body.insight.strengths.length === 5, '리뷰 인사이트');
});

test('캐시 hit: fetch 0, 쿨다운 중에도 반환', async () => {
  resetState(); const calls = fakeFetch(okPlan);
  await req(URL1);
  const n = calls.length;
  srv.state.cooldownUntil = srv.state.now() + 60_000;
  const r = await req(URL1, '2.2.2.2');
  assert.equal(r.body.mode, 'auto'); assert.equal(calls.length, n);
});

test('429 → 서버 공통 쿨다운, 대기 작업 전부 폴백, 쿨다운 중 miss는 즉시 폴백', async () => {
  resetState(); fakeFetch(() => ({ status: 429, text: '' }));
  const r = await req(URL1);
  assert.equal(r.body.mode, 'fallback'); assert.equal(r.body.reason, 'cooldown');
  assert.ok(srv.state.cooldownUntil > srv.state.now());
  const r2 = await req('https://m.place.naver.com/restaurant/1294253380/home', '3.3.3.3');
  assert.equal(r2.body.reason, 'cooldown');
});

test('탭 429도 쿨다운(홈 성공 후)', async () => {
  resetState(); fakeFetch((url) => /\/home$/.test(url) ? { status: 200, text: home } : { status: 429, text: '' });
  const r = await req(URL1);
  assert.equal(r.body.reason, 'cooldown');
});

test('비차단 실패(마커 없음) → 그 요청만 폴백, 쿨다운 아님', async () => {
  resetState(); fakeFetch(() => ({ status: 200, text: '<html>no marker</html>' }));
  const r = await req(URL1);
  assert.equal(r.body.reason, 'unreadable'); assert.equal(srv.state.cooldownUntil, 0);
});

test('쿨다운 만료 후 시험 1개: 비차단 실패 → 정상 복귀', async () => {
  const s = resetState(); fakeFetch(() => ({ status: 200, text: '<html>x</html>' }));
  s.cooldownUntil = s.now() + 1000; s.tick(2000);
  const r = await req(URL1);
  assert.equal(r.body.reason, 'unreadable'); assert.equal(s.probing, false); assert.equal(s.cooldownUntil, 0);
});

test('추가 탭 비차단 실패 → 부분 결과(해당 필드 missing), 캐시 저장', async () => {
  resetState(); fakeFetch((url) => /\/home$/.test(url) ? { status: 200, text: home } : new Error('timeout'));
  const r = await req(URL1);
  assert.equal(r.body.mode, 'auto');
  const c = srv.readCache('2086785604');
  assert.equal(c.reviews.status, 'missing'); assert.equal(c.feeds.status, 'missing');
});

test('IP 한도: 새 수집 3회/분, 4번째 429', async () => {
  resetState(); fakeFetch(() => ({ status: 200, text: '<html>x</html>' }));
  for (let i = 1; i <= 3; i++) await req(`https://m.place.naver.com/restaurant/${100 + i}/home`, '9.9.9.9');
  const r = await req('https://m.place.naver.com/restaurant/104/home', '9.9.9.9');
  assert.equal(r.code, 429); assert.equal(r.body.reason, 'ip_limit');
});

test('URL 오류 → no_url / unsupported', async () => {
  resetState(); fakeFetch(okPlan);
  assert.equal((await req('안녕하세요')).body.reason, 'no_url');
  assert.equal((await req('https://m.map.naver.com/search2/site.naver?code=123')).body.reason, 'unsupported');
});

test('단축 URL: 해석 1회 + 홈 + 탭 2개 + GraphQL 2회 = 6회', async () => {
  resetState(); const calls = fakeFetch((url) => url.includes('naver.me') ? { status: 200, url: URL1, text: '' } : okPlan(url));
  const r = await req('https://naver.me/AbCd1234');
  assert.equal(r.body.mode, 'auto'); assert.equal(calls.length, 6);
});

test('다시 읽어오기: 10분 이내면 캐시 재사용(refresh_denied), 지나면 새로 fetch', async () => {
  const s = resetState(); const calls = fakeFetch(okPlan);
  await req(URL1);
  const n = calls.length;
  let r = await req(URL1, '5.5.5.5', { refresh: true });
  assert.equal(r.body.mode, 'auto'); assert.equal(calls.length, n); assert.equal(r.body.cache.refresh_denied, true);
  s.tick(11 * 60 * 1000);
  r = await req(URL1, '5.5.5.5', { refresh: true });
  assert.equal(r.body.mode, 'auto'); assert.equal(calls.length, n + 5, '새로 5회 fetch'); assert.equal(r.body.cache, undefined);
  // refresh 없이 24시간 이내면 여전히 캐시
  r = await req(URL1, '6.6.6.6');
  assert.equal(calls.length, n + 5);
});

test('LLM 인사이트는 매장당 1회 호출 후 캐시 재사용', async () => {
  resetState(); fakeFetch(okPlan);
  let calls = 0;
  srv.state.llm = async () => { calls += 1; return { strengths: ['s1', 's2', 's3'], improvements: ['i1', 'i2', 'i3'] }; };
  const r1 = await req(URL1);
  assert.equal(r1.body.insight.source, 'llm'); assert.equal(calls, 1);
  const r2 = await req(URL1, '7.7.7.7');
  assert.equal(r2.body.insight.source, 'llm'); assert.equal(r2.body.insight.llm.strengths[0], 's1'); assert.equal(calls, 1, '캐시 hit 시 재호출 없음');
  srv.state.llm = null;
});

test('추가 탭 일시 실패 → 1회 재시도 후 성공', async () => {
  resetState(); let photoTries = 0;
  const calls = fakeFetch((url) => { if (/\/feed$/.test(url)) { photoTries += 1; if (photoTries === 1) return new Error('timeout'); } return okPlan(url); });
  const r = await req(URL1);
  assert.equal(r.body.mode, 'auto'); assert.equal(photoTries, 2); assert.equal(calls.length, 6);
  assert.equal(srv.readCache('2086785604').feeds.status, 'value');
});

test('리뷰 GraphQL: 커서로 2페이지, 6개월 창 밖 제외, SSR 20건과 병합·중복 제거', async () => {
  resetState({ now: Date.parse('2026-09-14T12:00:00+09:00') });
  const mk = (i, visited) => ({ id: 'g' + i, rating: 5, body: '본문' + i, visited, created: visited, cursor: 'c' + i, reply: null, votedKeywords: [], visitCategories: [] });
  const page1 = Array.from({ length: 50 }, (_, i) => mk(i, i < 49 ? '9.1.화' : '5.1.금'));
  const page2 = [mk(100, '4.1.수'), mk(101, '2.1.일')]; // 2026-04-01(창 안), 2026-02-01(창 밖)
  const gqlCalls = [];
  fakeFetch((url, n, opts) => {
    if (/graphql/.test(url)) { if (isCouponReq(opts)) return { status: 200, text: GQL_COUPONS }; gqlCalls.push(1); return { status: 200, text: JSON.stringify([{ data: { visitorReviews: { total: 999, items: gqlCalls.length === 1 ? page1 : page2 } } }]) }; }
    return okPlan(url);
  });
  const r = await req(URL1);
  assert.equal(r.body.mode, 'auto');
  const c = srv.readCache('2086785604');
  assert.equal(gqlCalls.length, 2, '50건 꽉 찬 첫 페이지 → 둘째 페이지 (쿠폰 요청은 별도 카운트)');
  assert.equal(c.reviewWindow.value.days, 180);
  const ids = c.reviews.value.map((x) => x.id);
  assert.ok(ids.includes('g100') && !ids.includes('g101'), '2월 리뷰는 6개월 창 밖');
  assert.ok(ids.length >= 51 + 1, 'GraphQL 51 + SSR 병합');
  assert.equal(new Set(ids).size, ids.length, '중복 없음');
  assert.ok(r.body.insight.stats.windowDays === 180 && r.body.insight.stats.byMonth.length >= 2);
});

test('키워드 LLM 추천도 매장당 1회 후 캐시', async () => {
  resetState(); fakeFetch(okPlan);
  let calls = 0; srv.state.llmKeywords = async () => { calls += 1; return { keywords: [{ keyword: '안국 돈카츠', why: 'r' }], diagnosis: [] }; };
  const r1 = await req(URL1); assert.equal(r1.body.keywords.llm.keywords[0].keyword, '안국 돈카츠'); assert.equal(calls, 1);
  const r2 = await req(URL1, '8.8.8.8'); assert.equal(r2.body.keywords.llm.keywords.length, 1); assert.equal(calls, 1);
  srv.state.llmKeywords = null;
});

test('상세설명 진단이 응답에 포함되고 LLM 제안은 캐시', async () => {
  resetState(); fakeFetch(okPlan);
  let calls = 0; srv.state.llmDescription = async () => { calls += 1; return { assessment: 'ok', keep: [], changes: [], add: [{ q: 'Q', a: 'A', why: 'w' }] }; };
  const r1 = await req(URL1);
  assert.ok(r1.body.description.analysis.length > 100); assert.equal(r1.body.description.llm.add.length, 1); assert.equal(calls, 1);
  const r2 = await req(URL1, '9.9.9.1'); assert.equal(r2.body.description.llm.add.length, 1); assert.equal(calls, 1);
  srv.state.llmDescription = null;
});

test('검색광고 키 있으면 월 검색수 조회·정렬·캐시', async () => {
  resetState(); fakeFetch(okPlan);
  srv.state.llmKeywords = async () => ({ keywords: [{ keyword: '안국 돈카츠', why: 'a' }, { keyword: '안국역 맛집', why: 'b' }], diagnosis: [] });
  let adCalls = 0;
  srv.state.adEnv = { NAVER_AD_API_KEY: 'k', NAVER_AD_SECRET: 's', NAVER_AD_CUSTOMER_ID: '1' };
  srv.state.fetchAd = async (url) => { adCalls += 1; const hints = decodeURIComponent(url.split('hintKeywords=')[1].split('&')[0]).split(','); return { status: 200, json: async () => ({ keywordList: hints.map((h) => ({ relKeyword: h, monthlyPcQcCnt: h === '안국역맛집' ? 900 : 10, monthlyMobileQcCnt: h === '안국역맛집' ? 3000 : 20 })) }) }; };
  const r1 = await req(URL1);
  assert.ok(adCalls >= 1); assert.equal(r1.body.keywords.llm.keywords[0].keyword, '안국역 맛집', '검색량 내림차순'); assert.equal(r1.body.keywords.llm.keywords[0].volume, 3900);
  const n = adCalls; const r2 = await req(URL1, '9.9.9.2'); assert.equal(adCalls, n, '캐시'); assert.equal(r2.body.keywords.llm.keywords[0].volume, 3900);
  srv.state.llmKeywords = null; srv.state.adEnv = {}; srv.state.fetchAd = undefined;
});

test('쿠폰 백데이터: 신규 수집 시 1줄 기록, 캐시 hit는 기록 없음, 관리자 집계 API', async () => {
  resetState(); fakeFetch(okPlan);
  try { fs.unlinkSync(process.env.PLACE_STATS_FILE); } catch {}
  await req(URL1); await req(URL1, '4.4.4.4');
  const lines = fs.readFileSync(process.env.PLACE_STATS_FILE, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1); const l = JSON.parse(lines[0]); assert.equal(l.placeId, '2086785604'); assert.equal(l.hasNotification, true); assert.ok(!('fresh' in (srv.readCache('2086785604') || {})));
  process.env.ADMIN_TOKEN = 't0k';
  const res = { writeHead(code) { this.code = code; }, end(body) { this.body = body; } };
  const server = srv.createServer();
  await new Promise((resolve) => { server.emit('request', { method: 'GET', url: '/api/stats/coupons?token=t0k', headers: {}, socket: {} }, { ...res, end(body) { res.end(body); resolve(); } }); });
  const agg = JSON.parse(res.body); assert.equal(agg.stores, 1); assert.equal(agg.withNotification, 1);
  await new Promise((resolve) => { server.emit('request', { method: 'GET', url: '/api/stats/coupons?token=wrong', headers: {}, socket: {} }, { writeHead(c) { this.c = c; }, end() { assert.equal(this.c, 404); resolve(); } }); });
  delete process.env.ADMIN_TOKEN;
});
