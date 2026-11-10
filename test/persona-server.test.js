'use strict';
// 손님 카드 라우트·보관·상한·잠금 — 가짜 fetch, 주입 시계, 주입 AI. 네트워크 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const TMP = path.join(os.tmpdir(), 'place-check-persona-test');
process.env.PLACE_CACHE_DIR = path.join(TMP, 'cache');
process.env.PLACE_STATS_FILE = path.join(TMP, 'cache', 'coupons.jsonl');
process.env.PERSONA_DIR = path.join(TMP, 'persona');
process.env.PLACE_USAGE_FILE = path.join(TMP, 'usage.jsonl');
process.env.PERSONA_CODES = '1234, 5678';
delete process.env.PERSONA_DAILY_MAX;
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server');
const ST = require('../lib/persona-store');

const FX = path.join(__dirname, 'fixtures');
const home = fs.readFileSync(path.join(FX, 'kise-anguk-home.html'), 'utf8');
const feed = fs.readFileSync(path.join(FX, 'kise-anguk-feed.html'), 'utf8');
const rvis = fs.readFileSync(path.join(FX, 'kise-anguk-review-visitor.html'), 'utf8');
srv.state.llm = null; srv.state.llmKeywords = null; srv.state.llmDescription = null; srv.state.adEnv = {};

const NOW = 1_800_000_000_000; // 2027-01-15
const val = (x) => ({ status: 'value', value: x });
const BODIES = [
  '점심에 혼자 가기 좋아요 자리가 넓어요', '회사 근처라 점심에 자주 와요 혼밥 최고', '혼밥하기 편한 1인석이 있어서 점심마다 옵니다', '혼자 와서 히레카츠 먹었는데 점심 줄이 길었어요',
  '여자친구랑 데이트하다 들렀어요 미소카츠 맛있음', '남편이랑 데이트 겸 왔는데 분위기 좋았습니다', '데이트 코스로 추천해요 사진 찍기 좋아요 연인',
  '퇴근하고 동료들이랑 맥주 한잔 했습니다 가라아게', '맥주가 음식보다 먼저 나와서 아쉬웠어요 회식', '동료들과 회식으로 왔어요 맥주랑 나베 조합',
  '그냥 맛있어요 또 올게요 정말 맛있어요', '친절하고 깔끔한 매장이라 만족했습니다 추천',
];
function facts(id, over = {}) {
  return {
    placeId: val(String(id)), name: val('테스트카츠 ' + id), category: val('돈가스'), placeType: 'restaurant', district_tokens: val(['강남구', '강남대로']),
    menus: val([{ name: '히레카츠', price: val('14900'), order: 0 }]),
    reviewStats: val({ totalCount: 300, avgRating: 4.6, menus: [{ name: '히레카츠', count: 40 }], votedKeywords: [{ name: '혼밥하기 좋아요', count: 80 }], votedTotal: 500, themes: [] }),
    reviews: val(BODIES.map((b, i) => ({ id: `${id}-${i}`, body: b, rating: 5, visited: '2026-12-20', created: '2026-12-21', votedKeywords: [], visitCategories: [] }))),
    fetched_at: new Date(NOW).toISOString(), ...over,
  };
}
const P1 = { nickname: '점심 혼밥 직장인 민준 씨', group: 'solo', gender: 'unknown', age: 'unknown', who: '근처 회사원', scene: '평일 점심에 혼자 와서 빨리 먹고 갑니다.', signals: [{ words: ['혼밥', '혼자'] }, { words: ['점심'] }], review_ids: [1, 2, 3, 4], menu_no: 1, likes: ['1인석'], dislikes: [], quotes: [{ review_id: 1, text: '점심에 혼자 가기 좋아요' }], group_evidence: [], demo_evidence: [], line: '혼자 와도 편한 1인석' };
const P2 = { ...P1, nickname: '데이트 커플 지현 씨', scene: '주말 저녁 데이트 코스로 들르는 커플입니다.', signals: [{ words: ['데이트'] }], review_ids: [5, 6, 7], menu_no: null, quotes: [] };
function fakeLlm({ cards = { personas: [P1, P2] }, extras = { phrases: ['혼밥', '데이트 코스'], copy: [{ persona: 1, news: '비밀소식문구', reply: '답글', insta: '인스타' }], missing: [] } } = {}) {
  const calls = { cards: 0, extras: 0 };
  srv.state.llmPersona = async (kind) => { calls[kind] += 1; const out = kind === 'cards' ? cards : extras; if (out instanceof Error) throw out; return typeof out === 'function' ? out() : out; };
  return calls;
}
function reset() {
  const s = srv.state;
  s.cooldownUntil = 0; s.probing = false; s.jobs.clear(); s.queue.length = 0; s.running = false; s.lastFetchStart = 0; s.ipLog.clear();
  s.personaJobs.clear(); s.personaExtraJobs.clear(); s.personaFailUntil.clear(); s.personaRunning = 0; s.personaWaiters.length = 0; s.personaIpLog.clear(); s.codeFailLog.clear(); s.personaUnlockSeen.clear();
  let t = NOW; s.now = () => t; s.tick = (ms) => { t += ms; };
  for (const f of fs.readdirSync(srv.CACHE_DIR)) fs.rmSync(path.join(srv.CACHE_DIR, f), { recursive: true, force: true });
  fs.rmSync(process.env.PERSONA_DIR, { recursive: true, force: true });
  delete process.env.PERSONA_DAILY_MAX;
  return s;
}
function fakeFetch(plan) {
  const calls = [];
  srv.state.fetchImpl = async (url, opts) => { calls.push(url); const r = plan(url, calls.length, opts); if (r instanceof Error) throw r; return { status: r.status, url: r.url || url, text: async () => r.text }; };
  return calls;
}
const GQL_EMPTY = JSON.stringify([{ data: { visitorReviews: { total: 0, items: [] } } }]);
const GQL_COUPONS = JSON.stringify([{ data: { unifiedCoupons: { total: 0, coupons: [], memberships: [] } } }]);
const okPlan = (url, n, opts) => /graphql/.test(url) ? { status: 200, text: opts && String(opts.body).includes('getUnifiedCoupons') ? GQL_COUPONS : GQL_EMPTY } : /\/home$/.test(url) ? { status: 200, text: home } : /\/review\/visitor$/.test(url) ? { status: 200, text: rvis } : /\/feed$/.test(url) ? { status: 200, text: feed } : { status: 404, text: '' };
function call(handler, body, ip = '10.0.0.1', xff) {
  return new Promise((resolve) => {
    const res = { writeHead(code) { this.code = code; }, end(b) { resolve({ code: this.code, body: JSON.parse(b), raw: b }); } };
    Promise.resolve(handler({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: ip } }, res, JSON.stringify(body))).catch((e) => resolve({ code: 500, body: { error: String(e) }, raw: '' }));
  });
}
const collect = (url, ip) => call(srv.handlePersonaCollect, { url, vid: 'abcdefgh12345678', ch: 'ig' }, ip);
const analyze = (placeId, ip, vid = 'abcdefgh12345678') => call(srv.handlePersonaAnalyze, { placeId, vid, ch: 'ig' }, ip);
const unlock = (placeId, code, ip, xff) => call(srv.handlePersonaUnlock, { placeId, code, vid: 'abcdefgh12345678' }, ip, xff);
const extrasDone = () => Promise.all([...srv.state.personaExtraJobs.values()]);
const URL_OF = (id, type = 'restaurant') => `https://m.place.naver.com/${type}/${id}/home`;

test('collect: 실제 픽스처 수집 → 매장 정보와 미리보기(최대 5개·60자)', async () => {
  reset(); fakeFetch(okPlan); fakeLlm();
  const r = await collect(URL_OF('2086785604'));
  assert.equal(r.body.ok, true); assert.equal(r.body.name, '키세카츠 안국역점'); assert.equal(r.body.placeId, '2086785604');
  assert.ok(r.body.peeks.length <= 5); assert.ok(r.body.peeks.every((p) => typeof p === 'string' && p.length <= 60));
  assert.ok(['enough', 'fair', 'thin', 'too_few'].includes(r.body.confidence));
});

test('collect: 주소 오류·지원 안 하는 주소·단축 주소가 엉뚱한 곳으로 가는 경우', async () => {
  reset(); fakeFetch((url) => (/naver\.me/.test(url) ? { status: 200, text: '', url: 'https://www.naver.com/' } : okPlan(url)));
  assert.equal((await collect('주소 아님')).body.reason, 'no_url');
  assert.equal((await collect('https://www.google.com/maps/place/x')).body.reason, 'unsupported');
  assert.equal((await collect('https://naver.me/abcd1234')).body.reason, 'unsupported');
});

test('비외식: collect와 analyze 양쪽에서 걸러지고 AI는 부르지 않는다', async () => {
  reset(); const calls = fakeLlm();
  srv.writeCache('555', facts('555', { category: val('미용실'), placeType: 'restaurant' }));
  const c = await collect(URL_OF('555'));
  assert.equal(c.body.ok, false); assert.equal(c.body.reason, 'not_food'); assert.equal(c.body.category, '미용실');
  const a = await analyze('555');
  assert.equal(a.body.status, 'not_food'); assert.equal(calls.cards, 0);
  const agg = ST.aggregate();
  assert.equal(agg.rejects['미용실'], 2);
});

test('리뷰를 못 읽은 수집은 리뷰 부족이 아니라 unreadable, 보관하지 않는다', async () => {
  reset(); const calls = fakeLlm();
  fakeFetch((url) => (/\/home$/.test(url) ? { status: 200, text: home } : new Error('timeout')));
  const c = await collect(URL_OF('2086785604'));
  assert.equal(c.body.ok, false); assert.equal(c.body.reason, 'unreadable');
  const a = await analyze('2086785604');
  assert.equal(a.body.status, 'unreadable'); assert.equal(calls.cards, 0);
  assert.equal(ST.readResult('2086785604', srv.state.now()), null);
});

test('리뷰 부족: AI 없이 too_few, 보관됨', async () => {
  reset(); const calls = fakeLlm();
  const f = facts('556'); f.reviews.value = f.reviews.value.slice(0, 3);
  srv.writeCache('556', f);
  const a = await analyze('556');
  assert.equal(a.body.status, 'too_few'); assert.equal(a.body.locked, false); assert.equal(calls.cards, 0);
  assert.equal(ST.readResult('556', srv.state.now()).status, 'too_few');
  assert.equal(ST.dailyCount(srv.state.now()), 0, '유료 예산을 쓰지 않음');
});

test('analyze → 잠긴 응답에는 2번 카드 본문·추가 분석이 없고, 맞는 코드로만 열린다', async () => {
  reset(); const calls = fakeLlm();
  srv.writeCache('600', facts('600'));
  const a = await analyze('600');
  assert.equal(a.body.status, 'ok'); assert.equal(a.body.cards.length, 2); assert.equal(a.body.locked, true);
  assert.equal(a.body.cards[0].count, 4); assert.deepEqual(a.body.cards[0].quotes.map((q) => q.text), ['점심에 혼자 가기 좋아요']);
  assert.ok(!a.raw.includes('데이트 코스로 들르는')); assert.ok(!a.raw.includes('비밀소식문구'));
  assert.equal(a.body.cards[1].locked, true); assert.equal(a.body.cards[1].nickname, '데이트 커플 지현 씨');
  await extrasDone();
  assert.deepEqual(calls, { cards: 1, extras: 1 });
  assert.equal((await unlock('600', '0000')).body.reason, 'bad_code');
  assert.equal((await unlock('600', undefined)).body.reason, 'bad_code');
  const u = await unlock('600', '5678');
  assert.equal(u.body.ok, true); assert.equal(u.body.locked, false); assert.equal(u.body.extras_status, 'ready');
  assert.ok(u.raw.includes('데이트 코스로 들르는')); assert.ok(u.raw.includes('비밀소식문구'));
  assert.deepEqual(u.body.extras.phrases, ['혼밥', '데이트 코스']);
  assert.equal((await unlock('999', '1234')).body.reason, 'expired');
  // 다시 조회: 보관 결과, AI 추가 호출 없음
  const again = await analyze('600');
  assert.equal(again.body.status, 'ok'); assert.equal(calls.cards, 1);
  const agg = ST.aggregate(); const day = Object.values(agg.days)[0];
  assert.equal(day.analyze, 1); assert.equal(day.view, 1); assert.equal(day.unlock, 1); assert.equal(day.visitors, 1); assert.equal(day.unlockers, 1);
});

test('틀린 코드는 같은 접속 주소에서 분당 10회까지(전달 헤더를 바꿔도), 맞는 코드는 여러 번 가능', async () => {
  reset(); fakeLlm();
  srv.writeCache('601', facts('601')); await analyze('601'); await extrasDone();
  for (let i = 0; i < 10; i++) assert.equal((await unlock('601', String(1000 + i).slice(0, 4).replace('1234', '0001'), '20.0.0.1', `9.9.9.${i}`)).body.reason, 'bad_code');
  const blocked = await unlock('601', '0002', '20.0.0.1', '8.8.8.8');
  assert.equal(blocked.code, 429); assert.equal(blocked.body.reason, 'slow_down');
  assert.equal((await unlock('601', '1234', '20.0.0.1')).code, 429, '막힌 주소는 맞는 코드도 잠시 거절(무차별 대입 방지)');
  for (let i = 0; i < 15; i++) assert.equal((await unlock('601', '1234', '30.0.0.1')).body.ok, true);
  srv.state.tick(61_000);
  assert.equal((await unlock('601', '1234', '20.0.0.1')).body.ok, true, '1분 뒤 풀림');
});

test('전달 헤더는 같은 기계의 프록시를 거친 요청에서만 믿는다', () => {
  assert.equal(srv.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '50.0.0.1' } }), '50.0.0.1');
  assert.equal(srv.clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: { remoteAddress: '127.0.0.1' } }), '1.2.3.4');
  assert.equal(srv.clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
});

test('같은 매장 동시 요청은 AI 1회', async () => {
  reset(); const calls = fakeLlm();
  srv.writeCache('602', facts('602'));
  const [a, b] = await Promise.all([analyze('602', '10.0.0.1'), analyze('602', '10.0.0.2')]);
  assert.equal(a.body.status, 'ok'); assert.equal(b.body.status, 'ok'); assert.equal(calls.cards, 1);
  assert.equal(ST.dailyCount(srv.state.now()), 1);
});

test('AI 실패는 보관하지 않고, 60초 동안은 재호출 없이 failed', async () => {
  reset(); const calls = fakeLlm({ cards: null });
  srv.writeCache('603', facts('603'));
  assert.equal((await analyze('603')).body.status, 'failed'); assert.equal(calls.cards, 1);
  assert.equal(ST.readResult('603', srv.state.now()), null);
  assert.equal((await analyze('603')).body.status, 'failed'); assert.equal(calls.cards, 1, '60초 안에는 재호출 없음');
  srv.state.tick(61_000);
  fakeLlm();
  assert.equal((await analyze('603')).body.status, 'ok');
  // 카드 0장(검증 탈락)·예외도 failed
  reset(); fakeLlm({ cards: { personas: [{ ...P1, signals: [{ words: ['맛있어요'] }] }] } });
  srv.writeCache('604', facts('604'));
  assert.equal((await analyze('604')).body.status, 'failed');
  reset(); fakeLlm({ cards: new Error('boom') });
  srv.writeCache('605', facts('605'));
  assert.equal((await analyze('605')).body.status, 'failed');
});

test('하루 상한: 서로 다른 매장이 동시에 와도 상한을 넘겨 AI를 부르지 않는다', async () => {
  reset(); const calls = fakeLlm(); process.env.PERSONA_DAILY_MAX = '1';
  srv.writeCache('610', facts('610')); srv.writeCache('611', facts('611'));
  const [a, b] = await Promise.all([analyze('610', '10.0.0.1'), analyze('611', '10.0.0.2')]);
  assert.deepEqual([a.body.status, b.body.status].sort(), ['closed', 'ok']); assert.equal(calls.cards, 1);
  const okId = a.body.status === 'ok' ? '610' : '611';
  assert.equal((await analyze(okId)).body.status, 'ok', '보관된 결과 조회는 상한과 무관');
  // 실패한 시도도 예산을 쓴다(돌려주지 않음)
  reset(); process.env.PERSONA_DAILY_MAX = '1'; const c2 = fakeLlm({ cards: null });
  srv.writeCache('612', facts('612')); srv.writeCache('613', facts('613'));
  assert.equal((await analyze('612')).body.status, 'failed');
  assert.equal((await analyze('613')).body.status, 'closed'); assert.equal(c2.cards, 1);
});

test('새 분석 요청은 접속 주소당 분당 6회', async () => {
  reset(); fakeLlm();
  for (let i = 0; i < 7; i++) srv.writeCache(String(620 + i), facts(620 + i));
  for (let i = 0; i < 6; i++) assert.equal((await analyze(String(620 + i), '40.0.0.1')).body.status, 'ok');
  const r = await analyze('626', '40.0.0.1');
  assert.equal(r.code, 429); assert.equal(r.body.status, 'slow_down');
  assert.equal((await analyze('620', '40.0.0.1')).body.status, 'ok', '보관 결과 조회는 제한 없음');
});

test('보관 결과는 사실 캐시가 지워지고 쿨다운 중이어도 조회된다(수집·AI 0)', async () => {
  reset(); const calls = fakeLlm(); const fetched = fakeFetch(okPlan);
  srv.writeCache('630', facts('630')); await analyze('630'); await extrasDone();
  fs.unlinkSync(path.join(srv.CACHE_DIR, '630.json'));
  srv.state.tick(2 * 24 * 3600 * 1000);
  srv.state.cooldownUntil = srv.state.now() + 60_000;
  const c = await collect(URL_OF('630'));
  assert.equal(c.body.ok, true); assert.equal(c.body.cached, true); assert.equal(c.body.name, '테스트카츠 630');
  const a = await analyze('630');
  assert.equal(a.body.status, 'ok'); assert.equal(calls.cards, 1); assert.equal(fetched.length, 0);
  assert.equal((await unlock('630', '1234')).body.ok, true);
  srv.state.cooldownUntil = 0; srv.state.tick(6 * 24 * 3600 * 1000);
  assert.equal((await analyze('630')).body.status, 'expired', '7일 지나면 만료(사실 캐시도 없음)');
});

test('추가 분석 실패는 failed로 끝나고, 오래 멈춘 pending은 한 번 다시 돌린다', async () => {
  reset(); fakeLlm({ extras: null });
  srv.writeCache('640', facts('640')); await analyze('640'); await extrasDone();
  const u = await unlock('640', '1234');
  assert.equal(u.body.extras_status, 'failed'); assert.equal(u.body.extras, null); assert.equal(u.body.cards.length, 2);

  reset(); fakeLlm({ extras: new Error('x') });
  srv.writeCache('641', facts('641')); await analyze('641'); await extrasDone();
  assert.equal((await unlock('641', '1234')).body.extras_status, 'failed');

  // 서버 재시작 흉내: pending으로 저장된 채 작업이 사라짐
  reset(); const calls = fakeLlm();
  srv.writeCache('642', facts('642')); await analyze('642'); await extrasDone();
  const stored = ST.readResult('642', srv.state.now());
  ST.writeResult('642', { ...stored, extras: null, extras_status: 'pending' }, srv.state.now());
  assert.equal((await unlock('642', '1234')).body.extras_status, 'pending', '120초 전에는 기다림');
  srv.state.tick(121_000);
  const [x, y] = await Promise.all([unlock('642', '1234'), unlock('642', '1234')]);
  assert.equal(x.body.extras_status, 'pending'); assert.equal(y.body.extras_status, 'pending');
  await extrasDone();
  assert.equal(calls.extras, 2, '처음 1회 + 재시작 1회(동시 요청에도 1회)');
  assert.equal((await unlock('642', '1234')).body.extras_status, 'ready');
  // 두 번 시도한 뒤에도 pending이면 failed로 닫는다
  const s2 = ST.readResult('642', srv.state.now());
  ST.writeResult('642', { ...s2, extras: null, extras_status: 'pending' }, srv.state.now());
  srv.state.tick(121_000);
  assert.equal((await unlock('642', '1234')).body.extras_status, 'failed');
  assert.equal(calls.extras, 2);
});

test('손님 카드 분석은 플레이스 체크의 검사 수 집계를 건드리지 않는다', async () => {
  reset(); fakeFetch(okPlan); fakeLlm();
  const hitsFile = path.join(path.dirname(process.env.PLACE_STATS_FILE), 'hits.json');
  const checks = () => { try { return Object.values(JSON.parse(fs.readFileSync(hitsFile, 'utf8'))).reduce((s, d) => s + (d.checks || 0) + (d.cache || 0), 0); } catch { return 0; } };
  const before = checks();
  const c = await collect(URL_OF('2086785604')); await analyze(c.body.placeId); await extrasDone();
  assert.equal(checks(), before);
});

test('잘못된 요청 본문', async () => {
  reset(); fakeLlm();
  assert.equal((await call(srv.handlePersonaAnalyze, { placeId: '../etc' })).code, 400);
  assert.equal((await call(srv.handlePersonaUnlock, { placeId: 'abc', code: '1234' })).code, 400);
  const res = await new Promise((resolve) => { const r = { writeHead(c) { this.code = c; }, end(b) { resolve({ code: this.code, body: JSON.parse(b) }); } }; srv.handlePersonaCollect({ headers: {}, socket: {} }, r, '{bad json'); });
  assert.equal(res.code, 400);
});
