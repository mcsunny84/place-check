'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/coupons');
const V = (x) => ({ status: 'value', value: x });

const RAW = { total: 1, coupons: [{ promotionSeq: 1, promotionTitle: '알림받기 에비후라이 증정쿠폰', conditionType: 'PLACE_BENEFIT_NOTIFICATION_SUBSCRIBED', couponUseType: 'ALL', title: '에비후라이 100% 무료제공 쿠폰', description: '알림받기한 고객님들께 드려요', type: 'gift', status: 'download', expiredPeriodInfo: '오늘 받으면 2026.09.20.까지 유효', usedConditionInfos: ['다른 메뉴와 함께 주문 시에만 사용 가능', '쿠폰 중복 사용 불가'] }], memberships: [] };

test('classify: conditionType 우선, 제목 보조', () => {
  assert.equal(C.classify('PLACE_BENEFIT_NOTIFICATION_SUBSCRIBED', ''), '알림받기');
  assert.equal(C.classify('SOMETHING_ELSE', '첫 방문 손님 음료'), '첫방문');
  assert.equal(C.classify('', '재방문 감사 쿠폰'), '재방문');
  assert.equal(C.classify('', '점심 할인'), '일반');
});

test('normalizeCoupons: 필드 정규화, 개인정보 없음', () => {
  const n = C.normalizeCoupons(RAW);
  assert.equal(n.total, 1); assert.equal(n.coupons[0].kind, '알림받기'); assert.equal(n.coupons[0].title, '에비후라이 100% 무료제공 쿠폰');
  assert.deepEqual(Object.keys(n.coupons[0]).sort(), ['conditionType', 'conditions', 'expiredPeriodInfo', 'kind', 'promotionTitle', 'status', 'title', 'type', 'useType']);
  assert.equal(C.normalizeCoupons(null), null);
  assert.deepEqual(C.normalizeCoupons({ total: 0, coupons: [], memberships: [] }).coupons, []);
});

test('couponInsight: 없음 → 알림받기 권고 / 있으나 알림받기 없음 → 추가 권고 / 있음 → 유지', () => {
  const none = C.couponInsight({ coupons: V({ total: 0, coupons: [], memberships: [] }) });
  assert.equal(none.count, 0); assert.ok(none.tips[0].text.includes('알림받기 쿠폰'));
  const gen = C.couponInsight({ coupons: V({ total: 1, coupons: [{ title: '점심 할인', kind: '일반', conditions: [] }], memberships: [] }) });
  assert.equal(gen.hasNotification, false); assert.ok(gen.tips[0].text.includes('알림받기'));
  const ok = C.couponInsight({ coupons: V(C.normalizeCoupons(RAW)) });
  assert.equal(ok.hasNotification, true); assert.ok(ok.tips[0].text.includes('에비후라이'));
  assert.equal(C.couponInsight({ coupons: { status: 'missing' } }), null);
});

test('statsLine + aggregate: 매장별 마지막 기록 기준 집계', () => {
  const f = { placeId: V('1'), name: V('A'), category: V('돈가스'), coupons: V(C.normalizeCoupons(RAW)), visitorReviewsTotal: V(10) };
  const l1 = C.statsLine(f, { district: '종로', score: 90, now: '2026-09-14T00:00:00Z' });
  assert.equal(l1.hasNotification, true); assert.equal(l1.kinds[0], '알림받기'); assert.equal(l1.score, 90);
  const l2 = C.statsLine({ placeId: V('2'), name: V('B'), category: V('카페'), coupons: V({ total: 0, coupons: [], memberships: [] }) }, {});
  const agg = C.aggregate([l1, l2, { ...l2, couponCount: 1, kinds: ['일반'], titles: ['x'] }]);
  assert.equal(agg.stores, 2); assert.equal(agg.withCoupon, 2); assert.equal(agg.withNotification, 1); assert.equal(agg.byKind['알림받기'], 1); assert.equal(agg.byCategory['카페'].withCoupon, 1);
  assert.equal(C.statsLine({ coupons: { status: 'missing' } }), null);
});
