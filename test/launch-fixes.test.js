'use strict';
// 배포 전 수정 회귀(09번 코드리뷰 반영): KST 날짜, 동시 요청 분석 공유, 리뷰 수집 완료 표시, D1/D3 판정, 초안 사실 왜곡, LLM 결과 검증.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PLACE_CACHE_DIR = path.join(require('node:os').tmpdir(), 'place-check-test-cache-launch');
process.env.PLACE_STATS_FILE = path.join(process.env.PLACE_CACHE_DIR, 'coupons.jsonl');
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server');
const P = require('../lib/place-parse');
const A = require('../lib/draft-analysis');
const R = require('../lib/review-insight');
const KL = require('../lib/keyword-llm');
const { factsToAnswers } = require('../lib/facts-to-answers');
const V = (x) => ({ status: 'value', value: x });
const E = { status: 'empty' };

test('reviewDate: 서버 TZ가 UTC여도 KST 새벽엔 오늘 리뷰를 작년으로 내리지 않음 / 없는 날짜 거절', () => {
  assert.equal(P.reviewDate('9.15.화', '2026-09-14T15:30:00Z'), '2026-09-15'); // = 9/15 00:30 KST
  assert.equal(P.reviewDate('9.16.수', '2026-09-14T15:30:00Z'), '2025-09-16');
  assert.equal(P.reviewDate('2026.2.31.화', '2026-09-14T15:30:00Z'), null);
});

test('hoursLine: 요일별 시간이 다르면 같은 것끼리 묶음', () => {
  const h = (day, start, end) => ({ day, start, end, breaks: [] });
  assert.equal(A.hoursLine([h('월', '10:00', '18:00'), h('화', '12:00', '20:00')]), '월 10:00~18:00, 화 12:00~20:00');
  assert.equal(A.hoursLine([h('월', '11:00', '21:00'), h('화', '11:00', '21:00'), h('수', '11:00', '21:00'), h('토', '11:00', '20:00')]), '월~수 11:00~21:00, 토 11:00~20:00');
});

test('analyzeDescription: 포장만 등록 → "배달은 하지 않습니다" 지어내지 않음 / 주차 원문 그대로 프롬프트에', () => {
  const facts = { conveniences: V(['포장']), parkingInfo: V('주차 불가'), reviewStats: V({}) };
  const a = A.analyzeDescription('', facts, {});
  const t = a.add.find((x) => x.q.includes('포장'));
  assert.equal(t.a, '포장 가능합니다.');
  const p = A.buildPrompt('', facts, {}, a);
  assert.ok(p.includes('주차: 주차 불가'), p.split('\n')[2]);
  assert.ok(!A.analyzeDescription('다양한 연령층이 즐깁니다.', facts, {}).topics.find((x) => x.key === 'road').covered, '"연령층"은 길 안내 아님');
});

test('review-insight: 테마 키가 name이어도 보완점 계산', () => {
  const d = R.deterministic({ reviewStats: V({ votedKeywords: [], themes: [{ name: '맛', count: 100 }, { name: '서비스', count: 1 }] }), reviews: V([]) });
  assert.ok(d.improvements.some((i) => i.kind === 'theme_low'));
});

test('LLM 결과 검증: 이상 원소·빈 배열은 폴백, 진단은 기존 키워드만', async () => {
  const facts = { name: V('x'), reviews: V([{ body: 'b', votedKeywords: [] }]), reviewStats: V({}) };
  assert.equal(await KL.recommendKeywordsLLM(facts, {}, { llm: async () => ({ keywords: [null, { keyword: '', why: 'w' }], diagnosis: [] }) }), null);
  const k = await KL.recommendKeywordsLLM(facts, { existing: ['경주 식당'] }, { llm: async () => ({ keywords: [{ keyword: '경주 바베큐', why: 'a' }, { keyword: '경주  바베큐', why: 'b' }], diagnosis: [{ keyword: '경주식당', verdict: 'keep', why: 'k' }, { keyword: '없는키워드', verdict: 'replace', why: 'r' }, { keyword: '경주식당', verdict: 'maybe', why: 'x' }] }) });
  assert.equal(k.keywords.length, 1); assert.equal(k.diagnosis.length, 1);
  const ins = await R.buildInsight(facts, { llm: async () => ({ strengths: [], improvements: [] }) });
  assert.equal(ins.source, 'rules');
  const desc = await A.reviseDescriptionLLM('', facts, {}, A.analyzeDescription('', facts, {}), { llm: async () => ({ assessment: 'ok', keep: 'oops', changes: [null], add: [{ q: 'q', a: 'a', why: 'w' }] }) });
  assert.deepEqual(desc.keep, []); assert.deepEqual(desc.changes, []); assert.equal(desc.add.length, 1);
});

test('D3 검출 우선: 소식 missing이어도 설명에 위반 문구 있으면 fail / D1은 창 밖 최신일도 사용', () => {
  const { auto } = factsToAnswers({ description: V('리뷰 작성 시 무료 쿠폰 드려요'), feeds: { status: 'missing' } }, { asOf: '2026-09-15' });
  assert.equal(auto.D3.state, 'fail');
  const r = factsToAnswers({ visitorReviewsTotal: V(3), reviews: V([]), latestReviewDate: V('2026-01-10') }, { asOf: '2026-09-15' });
  assert.equal(r.auto.D1.state, 'fail'); assert.equal(r.auto.D1.source, 'latestReviewDate'); assert.equal(r.auto.D2.state, 'unknown');
});

test('같은 수집분 동시 요청 → 분석(LLM) 1회 공유, 실패한 필드는 기존 성공값 안 지움', async () => {
  const s = srv.state; s.adEnv = {}; s.llm = null; s.llmDescription = null;
  for (const f of fs.readdirSync(srv.CACHE_DIR)) fs.unlinkSync(path.join(srv.CACHE_DIR, f));
  const facts = { placeId: V('42'), name: V('n'), fetched_at: '2026-09-15T00:00:00.000Z', roadAddress: V('서울 종로구 x'), category: V('돈가스') };
  srv.writeCache('42', facts);
  let calls = 0; s.llmKeywords = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { keywords: [{ keyword: '종로 돈가스', why: 'a' }], diagnosis: [] }; };
  const [a, b] = await Promise.all([srv.buildResponse(facts, '2026-09-15', 0), srv.buildResponse(facts, '2026-09-15', 1)]);
  assert.equal(calls, 1); assert.equal(a.keywords.llm.keywords[0].keyword, '종로 돈가스'); assert.equal(b.queued_position, 1);
  assert.equal(srv.readCache('42').keywords_llm.keywords[0].keyword, '종로 돈가스');
  s.llmKeywords = async () => null; // 다음 분석 실패 → 캐시의 성공값 유지
  const c = await srv.buildResponse({ ...srv.readCache('42'), keywords_llm: undefined }, '2026-09-15', 0);
  assert.equal(c.keywords.llm, null); assert.equal(srv.readCache('42').keywords_llm.keywords[0].keyword, '종로 돈가스');
  s.llmKeywords = null;
});

test('리뷰 수집: 둘째 페이지 실패 → complete=false, 같은 cursor 반복 → 중단', async () => {
  const s = srv.state; s.adEnv = {}; s.llm = null; s.llmKeywords = null; s.llmDescription = null;
  const now = Date.parse('2026-09-14T12:00:00+09:00'); s.now = () => now;
  const mk = (i, visited, cursor) => ({ id: 'g' + i, rating: 5, body: 'b', visited, created: visited, cursor, reply: null, votedKeywords: [], visitCategories: [] });
  const page = Array.from({ length: 50 }, (_, i) => mk(i, '9.1.화', 'same'));
  const home = fs.readFileSync(path.join(__dirname, 'fixtures', 'kise-anguk-home.html'), 'utf8');
  let n = 0;
  s.fetchImpl = async (url, opts) => {
    if (!/graphql/.test(url)) return { status: /\/home$/.test(url) ? 200 : 404, url, text: async () => (/\/home$/.test(url) ? home : '') };
    if (/getUnifiedCoupons/.test(opts.body)) return { status: 200, url, text: async () => JSON.stringify([{ data: { unifiedCoupons: { total: 0, coupons: [], memberships: [] } } }]) };
    n += 1; if (n === 2) throw new Error('timeout');
    return { status: 200, url, text: async () => JSON.stringify([{ data: { visitorReviews: { total: 999, items: page } } }]) };
  };
  const out = await srv.collect({ placeId: '2086785604', type: 'restaurant', waiters: [] }).catch((e) => ({ err: e }));
  assert.ok(!out.err, out.err && out.err.message);
  assert.equal(out.facts.reviewWindow.value.complete, false);
  assert.equal(out.facts.reviewWindow.value.fetched, 50);
  n = 0;
  s.fetchImpl = async (url, opts) => {
    if (!/graphql/.test(url)) return { status: /\/home$/.test(url) ? 200 : 404, url, text: async () => (/\/home$/.test(url) ? home : '') };
    if (/getUnifiedCoupons/.test(opts.body)) return { status: 200, url, text: async () => JSON.stringify([{ data: { unifiedCoupons: { total: 0, coupons: [], memberships: [] } } }]) };
    n += 1; return { status: 200, url, text: async () => JSON.stringify([{ data: { visitorReviews: { total: 999, items: page } } }]) };
  };
  for (const f of fs.readdirSync(srv.CACHE_DIR)) fs.unlinkSync(path.join(srv.CACHE_DIR, f));
  await srv.collect({ placeId: '2086785604', type: 'restaurant', waiters: [] });
  assert.equal(n, 2, '같은 cursor가 다시 오면 3번째 요청 없음');
});
