'use strict';
// 쿠폰 현황 — pcmap GraphQL getUnifiedCoupons 응답 정규화·분류·권고, 백데이터 집계.
const v = (o) => (o && o.status === 'value' ? o.value : null);

// conditionType → 한국어 분류. 실측: PLACE_BENEFIT_NOTIFICATION_SUBSCRIBED(알림받기). 나머지는 이름에서 추정 후 '일반'.
const TYPE_MAP = [
  [/NOTIFICATION|SUBSCRIB|FOLLOW/i, '알림받기'],
  [/FIRST|NEW_VISIT|WELCOME/i, '첫방문'],
  [/REVISIT|RETURN|REPEAT/i, '재방문'],
  [/REVIEW/i, '리뷰'],
  [/BOOKING|RESERV/i, '예약'],
  [/ORDER|PICKUP|DELIVERY/i, '주문'],
  [/BIRTH|ANNIVERS/i, '생일'],
  [/MEMBER|STAMP|POINT/i, '멤버십'],
];
function classify(conditionType, title) {
  const key = String(conditionType || '');
  for (const [re, label] of TYPE_MAP) if (re.test(key)) return label;
  const t = String(title || '');
  if (/알림|팔로우|소식받기/.test(t)) return '알림받기';
  if (/첫\s*방문|신규/.test(t)) return '첫방문';
  if (/재방문/.test(t)) return '재방문';
  if (/생일|기념일/.test(t)) return '생일';
  return '일반';
}

// GraphQL 응답(unifiedCoupons) → 저장용 정규화 (개인 정보 없음: 쿠폰 제목·조건·기간만)
function normalizeCoupons(uc) {
  if (!uc || typeof uc !== 'object') return null;
  const coupons = Array.isArray(uc.coupons) ? uc.coupons.filter((c) => c && typeof c === 'object').map((c) => ({
    title: String(c.title || ''), promotionTitle: String(c.promotionTitle || ''), conditionType: String(c.conditionType || ''),
    kind: classify(c.conditionType, `${c.promotionTitle || ''} ${c.title || ''} ${c.description || ''}`),
    type: c.type || null, useType: c.couponUseType || null, status: c.status || null,
    expiredPeriodInfo: c.expiredPeriodInfo || null, conditions: Array.isArray(c.usedConditionInfos) ? c.usedConditionInfos.filter((x) => typeof x === 'string') : [],
  })) : [];
  const memberships = Array.isArray(uc.memberships) ? uc.memberships.filter(Boolean).map((m) => ({ name: m.membershipName || null, type: m.type || null, benefit: m.benefit && m.benefit.benefitName || null })) : [];
  return { total: typeof uc.total === 'number' ? uc.total : coupons.length, coupons, memberships };
}

// 화면용 인사이트 + 권고
function couponInsight(facts) {
  const c = v(facts.coupons);
  if (!c) return null;
  const kinds = [...new Set(c.coupons.map((x) => x.kind))];
  const hasNotify = kinds.includes('알림받기');
  const tips = [];
  if (c.coupons.length === 0) tips.push({ text: '쿠폰이 하나도 없어요. 가장 쉬운 건 "알림받기 쿠폰" — 손님이 알림받기(소식 구독)를 누르면 작은 서비스(음료·사이드)를 주는 방식이에요. 단골 알림 명단이 쌓이고, 소식·이벤트를 올릴 때마다 그 손님들에게 갑니다.', how: '스마트플레이스 > 쿠폰 > 쿠폰 만들기 > 조건 "알림받기" 선택 > 혜택은 원가 낮고 체감 큰 것(에비후라이 1개, 음료 1잔).' });
  else if (!hasNotify) tips.push({ text: `쿠폰 ${c.coupons.length}개 중 "알림받기" 조건 쿠폰이 없어요. 지금 쿠폰은 한 번 쓰고 끝나지만, 알림받기 쿠폰은 손님을 구독자로 남깁니다.`, how: '스마트플레이스 > 쿠폰 > 쿠폰 만들기 > 조건 "알림받기". 기존 쿠폰 하나를 알림받기 조건으로 바꿔도 돼요.' });
  else tips.push({ text: `알림받기 쿠폰이 있어요(${c.coupons.filter((x) => x.kind === '알림받기').map((x) => x.title).join(', ')}). 소식을 올릴 때마다 구독 손님에게 알림이 가니, 소식 주기를 월 1회 이상으로 유지하세요.`, how: null });
  if (c.coupons.length > 0 && !kinds.includes('첫방문') && !kinds.includes('재방문')) tips.push({ text: '첫방문·재방문 조건 쿠폰은 없어요. 여유가 되면 "재방문 쿠폰"(영수증 리뷰 후 다음 방문 혜택)이 재방문율에 직접 닿습니다.', how: '스마트플레이스 > 쿠폰 > 쿠폰 만들기 > 조건 "재방문".' });
  if (c.memberships.length) tips.push({ text: `멤버십(${c.memberships.map((m) => m.name).filter(Boolean).join(', ') || c.memberships.length + '개'})도 연결돼 있어요.`, how: null });
  return { count: c.coupons.length, kinds, hasNotification: hasNotify, coupons: c.coupons.map((x) => ({ title: x.title, kind: x.kind, expired: x.expiredPeriodInfo, conditions: x.conditions.slice(0, 3) })), memberships: c.memberships.length, tips };
}

// 백데이터 한 줄 (개인 정보 없음). 어떤 가게들이 어떤 쿠폰을 붙이는지 나중에 집계.
function statsLine(facts, extra = {}) {
  const c = v(facts.coupons);
  if (!c) return null;
  return {
    ts: new Date(extra.now || Date.now()).toISOString(), placeId: v(facts.placeId), name: v(facts.name), category: v(facts.category), district: extra.district || null,
    couponCount: c.coupons.length, kinds: c.coupons.map((x) => x.kind), titles: c.coupons.map((x) => x.title).slice(0, 10), conditionTypes: c.coupons.map((x) => x.conditionType),
    hasNotification: c.coupons.some((x) => x.kind === '알림받기'), memberships: c.memberships.length,
    visitorReviewsTotal: v(facts.visitorReviewsTotal), score: extra.score ?? null,
  };
}

// JSONL 집계: 매장은 마지막 기록 기준으로 1회만
function aggregate(lines) {
  const last = new Map();
  for (const l of lines) if (l && l.placeId) last.set(l.placeId, l);
  const rows = [...last.values()];
  const byKind = {}, titles = {}, byCategory = {};
  let withCoupon = 0, withNotify = 0, withMembership = 0;
  for (const r of rows) {
    if (r.couponCount > 0) withCoupon += 1;
    if (r.hasNotification) withNotify += 1;
    if (r.memberships > 0) withMembership += 1;
    for (const k of new Set(r.kinds || [])) byKind[k] = (byKind[k] || 0) + 1;
    for (const t of r.titles || []) titles[t] = (titles[t] || 0) + 1;
    const cat = r.category || '기타'; byCategory[cat] = byCategory[cat] || { stores: 0, withCoupon: 0 }; byCategory[cat].stores += 1; if (r.couponCount > 0) byCategory[cat].withCoupon += 1;
  }
  return { stores: rows.length, withCoupon, withNotification: withNotify, withMembership, byKind, byCategory, topTitles: Object.entries(titles).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([title, n]) => ({ title, n })) };
}

module.exports = { classify, normalizeCoupons, couponInsight, statsLine, aggregate, GQL_COUPONS: 'query getUnifiedCoupons($input: UnifiedCouponsInput) { unifiedCoupons(input: $input) { total coupons { promotionTitle conditionType couponUseType title description type status downloadableCountInfo expiredPeriodInfo usedConditionInfos couponButtonText } memberships { type membershipName benefit { benefitType benefitName couponName joinConditionType } } } }' };
