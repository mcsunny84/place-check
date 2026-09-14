'use strict';
// 큐·캐시·쿨다운 전이 회귀 (06번 §3·§5) — fake fetch, 주입 시계, 네트워크 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PLACE_CACHE_DIR = path.join(require('node:os').tmpdir(), 'place-check-test-cache');
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server');

const FX = path.join(__dirname, 'fixtures');
const home = fs.readFileSync(path.join(FX, 'kise-anguk-home.html'), 'utf8');
const feed = fs.readFileSync(path.join(FX, 'kise-anguk-feed.html'), 'utf8');
const photo = fs.readFileSync(path.join(FX, 'kise-anguk-photo.html'), 'utf8');
const info = fs.readFileSync(path.join(FX, 'kise-anguk-information.html'), 'utf8');
const rvis = fs.readFileSync(path.join(FX, 'kise-anguk-review-visitor.html'), 'utf8');
srv.state.llm = null; // 테스트에서 LLM 호출 금지

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
  srv.state.fetchImpl = async (url) => {
    calls.push(url);
    const r = plan(url, calls.length);
    if (r instanceof Error) throw r;
    return { status: r.status, url: r.url || url, text: async () => r.text };
  };
  return calls;
}
const okPlan = (url) => /\/home$/.test(url) ? { status: 200, text: home } : /\/review\/visitor$/.test(url) ? { status: 200, text: rvis } : /\/information$/.test(url) ? { status: 200, text: info } : /\/feed$/.test(url) ? { status: 200, text: feed } : /\/photo$/.test(url) ? { status: 200, text: photo } : { status: 404, text: '' };

function req(url, ip = '1.1.1.1', extra = {}) {
  return new Promise((resolve) => {
    const res = { writeHead(code) { this.code = code; }, end(body) { resolve({ code: this.code, body: JSON.parse(body) }); } };
    srv.handleCheck({ headers: { 'x-forwarded-for': ip }, socket: {} }, res, JSON.stringify({ url, ...extra }));
  });
}
const URL1 = 'https://m.place.naver.com/restaurant/2086785604/home';

test('정상: 홈+4탭 fetch, 결과 auto, 캐시 저장', async () => {
  resetState(); const calls = fakeFetch(okPlan);
  srv.state.lastFetchStart = 0; // 간격 대기 0
  const t0 = Date.now();
  const r = await req(URL1);
  assert.equal(r.body.mode, 'auto');
  assert.equal(r.body.place.name, '키세카츠 안국역점');
  assert.equal(calls.length, 5);
  assert.ok(srv.readCache('2086785604'));
  assert.ok(Date.now() - t0 >= 4 * 1500 - 50, '요청 시작 간격 1.5초 적용');
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
  assert.equal(c.description.status, 'missing'); assert.equal(c.feeds.status, 'missing');
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

test('단축 URL: 해석 1회 + 홈 + 탭 3개 = 5회', async () => {
  resetState(); const calls = fakeFetch((url) => url.includes('naver.me') ? { status: 200, url: URL1, text: '' } : okPlan(url));
  const r = await req('https://naver.me/AbCd1234');
  assert.equal(r.body.mode, 'auto'); assert.equal(calls.length, 5);
  assert.ok(!calls.some((u) => /\/photo$/.test(u)), 'photo 탭 생략');
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
