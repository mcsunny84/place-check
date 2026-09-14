'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/place-parse');
const { factsToAnswers } = require('../lib/facts-to-answers');
const R = require('../lib/review-insight');

const FX = path.join(__dirname, 'fixtures');
const html = (n) => fs.readFileSync(path.join(FX, n), 'utf8');
const NOW = new Date('2026-09-14T12:00:00+09:00');

test('reviewDate: 연도 없는 날짜 → 최근 과거, 미래면 작년, 연도 있으면 그대로', () => {
  assert.equal(P.reviewDate('9.12.토', NOW), '2026-09-12');
  assert.equal(P.reviewDate('9.14.월', NOW), '2026-09-14');
  assert.equal(P.reviewDate('10.1.수', NOW), '2025-10-01');
  assert.equal(P.reviewDate('2025.3.1.토', NOW), '2025-03-01');
  assert.equal(P.reviewDate('', NOW), null); assert.equal(P.reviewDate(null, NOW), null); assert.equal(P.reviewDate('13.40', NOW), null);
});

test('parseReviewVisitor: 안국역점 — 20건, 본문 10, 답글, 통계', () => {
  const base = P.parseHome(html('kise-anguk-home.html'));
  const f = P.parseReviewVisitor(html('kise-anguk-review-visitor.html'), base, { now: NOW });
  assert.equal(f.reviews.status, 'value'); assert.equal(f.reviews.value.length, 20);
  assert.equal(f.reviews.value.filter((r) => r.body).length, 10);
  assert.ok(f.reviews.value.every((r) => r.hasReply), '전부 답글 있음');
  assert.equal(f.reviews.value[0].visited, '2026-09-12');
  assert.equal(f.reviewStats.status, 'value');
  const s = f.reviewStats.value;
  assert.equal(s.totalCount, 1426); assert.equal(s.avgRating, 4.83);
  assert.equal(s.votedKeywords[0].name, '음식이 맛있어요'); assert.equal(s.votedKeywords[0].count, 1312);
  assert.ok(s.themes.find((t) => t.name === '맛' && t.count === 1119));
  // 원본 facts 불변
  assert.equal(base.reviews, undefined);
});

test('parseReviewVisitor: 마커 없음 → missing', () => {
  const f = P.parseReviewVisitor('<html></html>', { a: 1 }, { now: NOW });
  assert.equal(f.reviews.status, 'missing'); assert.equal(f.reviewStats.status, 'missing');
});

test('facts-to-answers: 리뷰 탭에서 D1 최신 방문일, D2 최신 답글일 자동', () => {
  let f = P.parseHome(html('kise-anguk-home.html'));
  f = P.parseReviewVisitor(html('kise-anguk-review-visitor.html'), f, { now: NOW });
  const { answers, auto } = factsToAnswers(f, { asOf: '2026-09-14' });
  assert.equal(answers.D1, '2026-09-13'); assert.equal(auto.D1.state, 'pass');
  assert.equal(answers.D2, '2026-09-14'); assert.equal(auto.D2.state, 'pass');
});

test('facts-to-answers: 최근 20건 전부 답글 없음 → D2 fail / 리뷰 탭 미수집 → unknown', () => {
  const base = { visitorReviewsTotal: { status: 'value', value: 10 }, reviews: { status: 'value', value: [{ id: '1', visited: '2026-09-01', created: null, rating: 5, body: 'x', replyCreated: null, hasReply: false, votedKeywords: [], visitCategories: [] }] } };
  const a = factsToAnswers(base, { asOf: '2026-09-14' });
  assert.equal(a.auto.D1.state, 'pass'); assert.equal(a.answers.D2, 'none'); assert.equal(a.auto.D2.state, 'fail');
  const b = factsToAnswers({ visitorReviewsTotal: { status: 'value', value: 10 }, reviews: { status: 'missing' } }, { asOf: '2026-09-14' });
  assert.equal(b.auto.D1.state, 'unknown'); assert.equal(b.auto.D2.state, 'unknown');
});

test('review-insight 결정론: 장점 5 = 투표 키워드 상위, 보완 = 답글 누락·낮은 별점·테마', () => {
  let f = P.parseHome(html('taeksan-home.html'));
  f = P.parseReviewVisitor(html('taeksan-review-visitor.html'), f, { now: NOW });
  const d = R.deterministic(f);
  assert.equal(d.strengths.length, 5); assert.equal(d.strengths[0].text, '음식이 맛있어요');
  assert.ok(d.improvements.some((i) => i.kind === 'low_rating'), '별점 3 리뷰 발췌');
  assert.ok(d.improvements.length <= 5);
  assert.equal(d.stats.recent, 20);
});

test('buildInsight: LLM 주입 성공 시 llm 결과, 실패/없음 시 rules만', async () => {
  let f = P.parseHome(html('kise-anguk-home.html'));
  f = P.parseReviewVisitor(html('kise-anguk-review-visitor.html'), f, { now: NOW });
  const ok = await R.buildInsight(f, { llm: async (prompt) => { assert.ok(prompt.includes('최근 리뷰 10건')); return { strengths: ['a', 'b', 'c'], improvements: ['x', 'y', 'z'] }; } });
  assert.equal(ok.source, 'llm'); assert.equal(ok.llm.strengths.length, 3); assert.equal(ok.strengths.length, 5);
  const bad = await R.buildInsight(f, { llm: async () => { throw new Error('boom'); } });
  assert.equal(bad.source, 'rules'); assert.equal(bad.llm, undefined);
  const none = await R.buildInsight(f, { llm: null });
  assert.equal(none.source, 'rules');
  assert.equal(await R.buildInsight({ reviews: { status: 'missing' }, reviewStats: { status: 'missing' } }, { llm: null }), null);
});
