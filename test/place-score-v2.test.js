'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V2 = require('../lib/place-score-v2');

const V = (value) => ({ status: 'value', value });
const E = { status: 'empty' };
const base = (over = {}) => ({
  name: V('테스트돈카츠'), category: V('돈가스'), roadAddress: V('서울 강남구 봉은사로 1'), jibunAddress: V('서울 강남구 역삼동 1-1'),
  subwayStations: V(['신논현역']), phone: V('02-000-0000'), virtualPhone: E, hideBusinessHours: V(false),
  businessHours: V([{ day: '매일', start: '11:00', end: '21:00', breaks: [] }]), road: V('2번 출구 직진'),
  conveniences: V(['주차']), homepages: E, naverBookingUsing: V(true), smartCallUsing: V(false), talktalkUrl: E,
  description: V(''), keywords: V([]), menus: E, menuImages: E, totalImages: V(10), feeds: E, feedsComplete: V(true),
  visitorReviewsTotal: V(0), reviews: E, coupons: V({ total: 0, coupons: [], memberships: [] }),
  ...over,
});
const item = (r, id) => r.items.find((i) => i.id === id);

test('v2: 채움만 한 매장은 v1처럼 만점 근처가 아니라 중하위로 나온다', () => {
  const r = V2.score(base(), { asOf: '2026-11-03' });
  assert.ok(r.score !== null && r.score < 50, `score ${r.score}`);
  assert.equal(r.axes.basic.score, 100);
  assert.ok(r.todos.length >= 3 && r.todos[0].lost >= r.todos[1].lost);
});

test('v2: 대표키워드는 개수가 아니라 칸별 규칙·검색량으로 본다', () => {
  const kws = ['역삼 돈카츠', '창덕궁창경궁외국인식당'];
  const vol = { '역삼 돈카츠': { total: 380 }, '창덕궁창경궁외국인식당': { total: 18 } };
  const k = item(V2.score(base({ keywords: V(kws) }), { asOf: '2026-11-03', volumes: vol }), 'K1');
  assert.equal(k.pts, 3); // 좋은 칸 1개(규칙 1.5 + 검색량 1.5), 붙여쓰기 칸 0
  assert.match(k.next, /빈 칸 3개/);
});

test('v2: 답글률과 응답 속도, 최근 30일 리뷰 수', () => {
  const reviews = Array.from({ length: 20 }, (_, i) => ({ id: String(i), visited: '2026-10-20', created: '2026-10-21', body: 'x'.repeat(i < 10 ? 60 : 10), hasReply: i < 10, replyCreated: i < 10 ? '2026-10-22' : null }));
  const r = V2.score(base({ visitorReviewsTotal: V(300), reviews: V(reviews) }), { asOf: '2026-11-03' });
  assert.equal(item(r, 'R4').pts, 4); // 50% × 속도 1
  assert.equal(item(r, 'R1').pts, 3); // 30일 20건 → 10건 단계
  assert.equal(item(r, 'R3').pts, round(8 * 0.5 / 0.6));
});
const round = (n) => Math.round(n * 10) / 10;

test('v2: 미수집 항목은 0점이 아니라 분모에서 빠진다', () => {
  const r = V2.score(base({ description: { status: 'missing' }, totalImages: { status: 'missing' } }), { asOf: '2026-11-03' });
  assert.equal(item(r, 'T0').pts, null);
  assert.equal(item(r, 'M1').pts, null);
  assert.ok(r.coverage < 1);
});
