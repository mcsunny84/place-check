'use strict';
// 손님 카드: 리뷰 선별·업종 판정·AI 응답 검증(건수 재집계·인용 대조)·공개 응답 가공. 네트워크 0, AI는 가짜 응답.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/persona');
const { parseHome } = require('../lib/place-parse');

const NOW = Date.parse('2026-11-10T03:00:00Z');
const val = (x) => ({ status: 'value', value: x });
const rv = (id, body, extra = {}) => ({ id: String(id), body, rating: 5, visited: '2026-10-20', created: '2026-10-21', votedKeywords: [], visitCategories: [], ...extra });
const BODIES = [
  '점심에 혼자 가기 좋아요 자리가 넓어요',          // 1
  '회사 근처라 점심에 자주 와요 혼밥 최고',          // 2
  '혼밥하기 편한 1인석이 있어서 점심마다 옵니다',    // 3
  '혼자 와서 히레카츠 먹었는데 점심 줄이 길었어요',  // 4
  '여자친구랑 데이트하다 들렀어요 미소카츠 맛있음',  // 5
  '남편이랑 데이트 겸 왔는데 분위기 좋았습니다',     // 6
  '데이트 코스로 추천해요 사진 찍기 좋아요 연인',    // 7
  '퇴근하고 동료들이랑 맥주 한잔 했습니다 가라아게', // 8
  '맥주가 음식보다 먼저 나와서 아쉬웠어요 회식',     // 9
  '동료들과 회식으로 왔어요 맥주랑 나베 조합',       // 10
  '그냥 맛있어요 또 올게요 정말 맛있어요',           // 11
  '친절하고 깔끔한 매장이라 만족했습니다 추천',      // 12
];
function mkFacts(bodies = BODIES, over = {}) {
  return {
    placeId: val('123'), name: val('테스트카츠'), category: val('돈가스'), placeType: 'restaurant',
    district_tokens: val(['강남구', '강남대로']),
    menus: val([{ name: '히레카츠', price: val('14900'), order: 0 }, { name: '히레카츠 + 면세트', price: val('19900'), order: 1 }, { name: '시가 메뉴', price: { status: 'missing' }, order: 2 }]),
    reviewStats: val({ totalCount: 300, avgRating: 4.6, menus: [{ name: '히레카츠', count: 40 }], votedKeywords: [{ name: '음식이 맛있어요', count: 200 }, { name: '혼밥하기 좋아요', count: 80 }], votedTotal: 500, themes: [] }),
    reviews: val(bodies.map((b, i) => rv(i + 1, b))),
    ...over,
  };
}
const persona = (over) => ({ nickname: '점심 혼밥 직장인 민준 씨', group: 'solo', gender: 'unknown', age: 'unknown', who: '근처 회사원', scene: '평일 점심에 혼자 옵니다.', signals: [{ words: ['혼밥', '혼자'] }, { words: ['점심'] }], review_ids: [1, 2, 3, 4], menu_no: 1, likes: ['1인석'], dislikes: [], quotes: [], group_evidence: [], demo_evidence: [], line: '혼자 와도 편한 1인석', ...over });
const couple = (over) => persona({ nickname: '데이트 커플 지현 씨', group: 'couple', scene: '주말 저녁 데이트로 들릅니다.', signals: [{ words: ['데이트'] }], review_ids: [5, 6, 7], menu_no: null, ...over });
const beer = (over) => persona({ nickname: '퇴근 후 한잔 모임', group: 'coworkers', scene: '퇴근 후 동료와 옵니다.', signals: [{ words: ['맥주'] }, { words: ['동료', '회식'] }], review_ids: [8, 9, 10], menu_no: null, ...over });
const run = (personas, facts = mkFacts(), conf) => { const reviews = P.selectReviews(facts, NOW); return P.verifyCards({ personas }, facts, reviews, conf || P.confidence(reviews.length)); };

test('selectReviews: 본문 없음·10자 미만·180일 밖 제외, 60건 상한, n은 1부터', () => {
  const many = Array.from({ length: 61 }, (_, i) => `리뷰 본문입니다 번호 ${i} 맛있게 먹었습니다`);
  const facts = mkFacts(many);
  facts.reviews.value.push(rv(900, null), rv(901, '짧아요'), rv(902, '아주 오래된 리뷰 본문입니다 맛있어요', { visited: '2026-01-01', created: '2026-01-01' }), rv(903, '날짜 없는 리뷰도 본문이 있으면 씁니다', { visited: null, created: null }));
  const r = P.selectReviews(facts, NOW);
  assert.equal(r.length, 60); assert.equal(r[0].n, 1); assert.equal(r[59].n, 60);
  assert.ok(!r.some((x) => ['900', '901', '902'].includes(x.id)));
  assert.deepEqual(P.selectReviews({ reviews: { status: 'missing' } }, NOW), []);
});

test('confidence 경계', () => {
  assert.equal(P.confidence(40), 'enough'); assert.equal(P.confidence(39), 'fair'); assert.equal(P.confidence(15), 'fair');
  assert.equal(P.confidence(14), 'thin'); assert.equal(P.confidence(5), 'thin'); assert.equal(P.confidence(4), 'too_few');
});

test('isFoodService: 주소 유형이 아니라 업종 문자열로 판정', () => {
  assert.equal(P.isFoodService(mkFacts()), true);
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: val('미용실'), placeType: 'restaurant' })), false);
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: val('요리주점') })), true);
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: val('종합소매'), reviewStats: val({ menus: [] }) })), false);
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: val('종합소매'), placeType: 'place' })), true, '네이버 리뷰 메뉴 통계가 있으면 외식');
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: { status: 'missing' }, reviewStats: { status: 'missing' } })), false);
  assert.equal(P.isFoodService(mkFacts(BODIES, { category: val('피부과의원') })), false);
});

test('illustrationKey: 22개 키 안에서만, unknown은 중립', () => {
  const k = (group, gender, age) => P.illustrationKey({ group, gender, age });
  assert.equal(k('solo', 'male', '30s'), 'solo-m-30s');
  assert.equal(k('solo', 'female', '60plus'), 'solo-f-60plus');
  assert.equal(k('solo', 'unknown', '30s'), 'solo-neutral');
  assert.equal(k('solo', 'male', 'unknown'), 'solo-neutral');
  assert.equal(k('couple', 'mixed', '40_50s'), 'couple-mid');
  assert.equal(k('couple', 'mixed', '20s'), 'couple-young');
  assert.equal(k('couple', 'unknown', 'unknown'), 'couple-neutral');
  assert.equal(k('friends', 'unknown', '20s'), 'friends-mixed');
  assert.equal(k('friends', 'female', '20s'), 'friends-f');
  assert.equal(k('company_dinner', 'mixed', 'unknown'), 'company-dinner');
  assert.equal(k('unknown', 'male', '30s'), 'solo-neutral');
  assert.equal(k('nonsense', 'x', 'y'), 'solo-neutral');
  assert.equal(P.ILLUSTRATION_KEYS.length, 22);
  for (const g of P.GROUPS) for (const s of P.GENDERS) for (const a of P.AGES) assert.ok(P.ILLUSTRATION_KEYS.includes(k(g, s, a)), `${g}/${s}/${a}`);
});

test('verifyCards: 정상 3장, 건수 순, 막대 이름은 실제로 나온 단어', () => {
  const cards = run([couple(), persona(), beer()], mkFacts(), 'fair');
  assert.equal(cards.length, 3);
  assert.deepEqual(cards.map((c) => c.count), [4, 3, 3]);
  assert.deepEqual(cards.map((c) => c.rank), [1, 2, 3]);
  assert.equal(cards[0].nickname, '점심 혼밥 직장인 민준 씨');
  assert.deepEqual(cards[0].signals, [{ label: '혼밥·혼자', count: 4 }, { label: '점심', count: 4 }]);
  assert.equal(cards[0].menu, '히레카츠'); assert.equal(cards[0].spend, '1.5만 원 안팎');
});

test('verifyCards: 같은 손님의 중복 번호는 1건, 범위 밖·문자열 번호는 버림', () => {
  assert.equal(run([persona({ review_ids: [1, 1, 1] })]).length, 0);
  assert.equal(run([persona({ review_ids: [1, 1, 2] })]).length, 0);
  const c = run([persona({ review_ids: [1, 2, 3, 3, 99, 0, -1, '4', 2.5] })]);
  assert.equal(c.length, 1); assert.equal(c[0].count, 3);
});

test('verifyCards: 두 손님이 같은 리뷰를 내면 먼저 채택된 손님만 가짐', () => {
  const cards = run([persona({ review_ids: [1, 2, 3] }), persona({ nickname: '둘째', review_ids: [2, 3, 4, 1] })]);
  assert.equal(cards.length, 1); assert.equal(cards[0].count, 3);
});

test('verifyCards: 탈락한 앞 손님은 리뷰를 선점하지 않는다', () => {
  const bad = persona({ nickname: '회식 단체', signals: [{ words: ['칵테일'] }], review_ids: [1, 2, 3] });
  const cards = run([bad, persona({ review_ids: [1, 2, 3] })]);
  assert.equal(cards.length, 1); assert.equal(cards[0].nickname, '점심 혼밥 직장인 민준 씨');
});

test('verifyCards: 신호 단어가 본문에 없으면 건수에서 빠지고, 일반어만으로는 통과 못 함', () => {
  const c = run([persona({ review_ids: [1, 2, 3, 12] })]);
  assert.equal(c[0].count, 3, '12번엔 혼밥·점심 없음');
  assert.equal(run([persona({ signals: [{ words: ['맛있어요', '친절'] }], review_ids: [5, 11, 12] })]).length, 0);
  assert.equal(run([persona({ signals: [{ words: ['가'] }], review_ids: [1, 2, 3] })]).length, 0, '2자 미만 단어 무시');
});

test('verifyCards: 방문 상황 태그도 근거가 된다', () => {
  const facts = mkFacts();
  for (const i of [10, 11]) facts.reviews.value[i].visitCategories = ['아이'];
  facts.reviews.value[9].visitCategories = ['아이'];
  const cards = run([persona({ nickname: '아이 동반 가족', group: 'family_kids', signals: [{ words: ['아이'] }], review_ids: [10, 11, 12], menu_no: null })], facts);
  assert.equal(cards.length, 1); assert.equal(cards[0].count, 3);
  assert.equal(cards[0].group, 'family_kids');
  assert.equal(cards[0].picture, 'family-kids');
});

test('verifyCards: 인용은 소유 리뷰의 원문 부분 문자열만(공백 차이 허용), 8~80자, 최대 2개', () => {
  const quotes = [
    { review_id: 1, text: '점심에  혼자 가기 좋아요' },           // 공백만 다름 → 통과
    { review_id: 2, text: '여기는 인생 맛집입니다 꼭 가세요' },    // 원문에 없음
    { review_id: 5, text: '여자친구랑 데이트하다 들렀어요' },      // 다른 손님 리뷰
    { review_id: 3, text: '혼밥' },                                // 8자 미만
    { review_id: 3, text: '혼밥하기 편한 1인석이 있어서' },
    { review_id: 4, text: '혼자 와서 히레카츠 먹었는데' },         // 3번째 → 잘림
  ];
  const c = run([persona({ quotes })])[0];
  assert.deepEqual(c.quotes.map((q) => q.text), ['점심에 혼자 가기 좋아요', '혼밥하기 편한 1인석이 있어서']);
  assert.equal(c.quotes[0].month, 10); assert.equal(c.quotes[0].rating, 5);
  const long = '가'.repeat(81);
  const f = mkFacts([...BODIES.slice(0, 3), `혼밥 점심 ${long}`]);
  assert.equal(run([persona({ review_ids: [1, 2, 3, 4], quotes: [{ review_id: 4, text: long }] })], f)[0].quotes.length, 0);
});

test('verifyCards: 불만은 소유 리뷰의 원문 근거가 있을 때만, 건수는 고유 리뷰 수', () => {
  const dislikes = [
    { text: '점심 줄이 길 때', evidence: [{ review_id: 4, quote: '점심 줄이 길었어요' }, { review_id: 4, quote: '줄이 길었어요' }] },
    { text: '직원이 불친절할 때', evidence: [{ review_id: 12, quote: '친절하고 깔끔한' }] },      // 다른(미소유) 리뷰 → 건수 없이
    { text: '음식이 늦게 나올 때', evidence: [{ review_id: 1, quote: '한 시간 기다렸어요' }] },   // 없는 문장 → 건수 없이
    { text: '넷째는 잘림', evidence: [] },
  ];
  const c = run([persona({ dislikes })])[0];
  assert.deepEqual(c.dislikes, [{ text: '점심 줄이 길 때', count: 1 }, { text: '직원이 불친절할 때', count: null }, { text: '음식이 늦게 나올 때', count: null }]);
});

test('verifyCards: 일행·성별·나이는 AI의 짐작을 그대로 쓴다(목록 밖 값만 unknown) — 마케팅용 추정', () => {
  const c = run([persona({ group: 'solo', gender: 'male', age: '30s' })])[0];
  assert.equal(c.group, 'solo'); assert.equal(c.gender, 'male'); assert.equal(c.age, '30s'); assert.equal(c.picture, 'solo-m-30s');
  const k = run([couple({ gender: 'mixed', age: '20s' })])[0];
  assert.equal(k.picture, 'couple-young');
  const bad = run([persona({ group: '외계인', gender: 'x', age: 99 })])[0];
  assert.equal(bad.group, 'unknown'); assert.equal(bad.gender, 'unknown'); assert.equal(bad.age, 'unknown'); assert.equal(bad.picture, 'solo-neutral');
  const none = run([persona({ group: 'unknown', gender: 'unknown', age: 'unknown' })])[0];
  assert.equal(none.picture, 'solo-neutral', 'AI가 모르겠다고 하면 중립');
});

test('verifyCards: 메뉴는 번호로만, 가격이 없으면 금액 숨김, 세트 가격과 섞이지 않음', () => {
  assert.equal(run([persona({ menu_no: 2 })])[0].spend, '2만 원 안팎');
  const noPrice = run([persona({ menu_no: 3 })])[0];
  assert.equal(noPrice.menu, '시가 메뉴'); assert.equal(noPrice.spend, null);
  const bad = run([persona({ menu_no: 9 })])[0];
  assert.equal(bad.menu, null); assert.equal(bad.spend, null);
  // 실제 픽스처: 히레카츠 단품과 세트가 같이 있는 메뉴판
  const home = parseHome(fs.readFileSync(path.join(__dirname, 'fixtures', 'kise-anguk-home.html'), 'utf8'));
  const list = P.menuList(home);
  const single = list.find((m) => m.name.replace(/\s/g, '') === '히레카츠');
  assert.ok(single, '단품 히레카츠가 목록에 있음');
  const f = mkFacts(BODIES, { menus: home.menus });
  const c = run([persona({ menu_no: single.no })], f)[0];
  assert.equal(c.menu, single.name); assert.equal(c.spend, P.spendText(single.price));
});

test('verifyCards: 근거 부족(thin)이면 2장까지, 그 밖은 3장까지', () => {
  const nine = BODIES.slice(0, 10).filter((_, i) => i !== 3); // 9건: 혼밥 3, 데이트 3, 맥주 3
  const f = mkFacts(nine);
  const three = [persona({ review_ids: [1, 2, 3] }), couple({ review_ids: [4, 5, 6] }), beer({ review_ids: [7, 8, 9] })];
  assert.equal(run(three, f).length, 2);
  assert.equal(run(three, f, 'fair').length, 3);
  const four = [...three, persona({ nickname: '넷째', signals: [{ words: ['맛있어요 또'] }], review_ids: [] })];
  assert.ok(run(four, f, 'enough').length <= 3);
});

test('verifyCards: 깨진 응답은 빈 배열', () => {
  const facts = mkFacts(); const reviews = P.selectReviews(facts, NOW);
  for (const raw of [null, undefined, {}, { personas: 'x' }, { personas: [null, 3, 'a', {}] }, 'str']) assert.deepEqual(P.verifyCards(raw, facts, reviews, 'fair'), []);
});

test('개인정보: 전화번호·계정이 있는 리뷰는 인용·미리보기에서 빠지고, 출력에 섞이면 카드 제거', () => {
  assert.equal(P.hasPii('문의는 010-1234-5678로'), true);
  assert.equal(P.hasPii('인스타 @kise_katsu 팔로우'), true);
  assert.equal(P.hasPii('메일 a.b@naver.com'), true);
  assert.equal(P.hasPii('https://blog.naver.com/x 참고'), true);
  assert.equal(P.hasPii('카톡 아이디 katsu1234'), true);
  assert.equal(P.hasPii('점심에 혼자 가기 좋아요 12,900원'), false);
  const bodies = ['혼밥 점심 예약은 010-1234-5678 로 주세요 감사합니다', ...BODIES.slice(1)];
  const f = mkFacts(bodies);
  assert.ok(!P.peeks(f, NOW).some((p) => p.includes('010')));
  const c = run([persona({ quotes: [{ review_id: 1, text: '예약은 010-1234-5678 로 주세요' }] })], f)[0];
  assert.equal(c.quotes.length, 0);
  assert.ok(!P.buildCardsPrompt(f, P.selectReviews(f, NOW)).includes('1234-5678'));
  assert.equal(run([persona({ nickname: '민준 010-1234-5678' })]).length, 0);
  assert.deepEqual(run([persona({ likes: ['1인석', '문의 010-1234-5678'] })])[0].likes, ['1인석']);
});

test('peeks: 최대 5개, 각 60자 이내', () => {
  const p = P.peeks(mkFacts(['가'.repeat(200), ...BODIES]), NOW);
  assert.equal(p.length, 5); assert.ok(p.every((x) => x.length <= 60));
});

test('when: 평일/주말 건수와 언급된 시간대', () => {
  const f = mkFacts();
  f.reviews.value[0].visited = '2026-10-24'; // 토
  f.reviews.value[1].visited = '2026-10-25'; // 일
  const w = P.when(P.selectReviews(f, NOW));
  assert.equal(w.weekend, 2); assert.equal(w.weekday, 10);
  assert.deepEqual(w.mentions.find((m) => m.label === '점심'), { label: '점심', count: 4 });
  assert.ok(!w.mentions.some((m) => m.count === 0));
});

test('verifyExtras: 자주 쓰는 말은 리뷰 원문이나 투표 키워드에 있는 것만', () => {
  const facts = mkFacts(); const reviews = P.selectReviews(facts, NOW); const cards = run([persona(), couple()]);
  const raw = { phrases: ['혼밥', '지역 1위 맛집', '혼밥하기 좋아요', '혼밥', '데이트 코스'], copy: [{ persona: 1, news: '소식 문구', reply: '답글 문구', insta: '인스타 문구' }, { persona: 9, news: 'x', reply: 'y', insta: 'z' }], missing: [{ who: '주말 가족', why: '리뷰에 안 보여요', how: '키즈 메뉴' }, { who: 'b', why: 'c', how: 'd' }, { who: 'e', why: 'f', how: 'g' }] };
  const e = P.verifyExtras(raw, facts, reviews, cards);
  assert.deepEqual(e.phrases, ['혼밥', '혼밥하기 좋아요', '데이트 코스']);
  assert.equal(e.copy.length, 1); assert.equal(e.copy[0].persona, 1);
  assert.equal(e.missing.length, 2);
  assert.ok(e.when && typeof e.when.weekday === 'number');
  assert.equal(P.verifyExtras(null, facts, reviews, cards), null);
});

test('publicView: 잠긴 내용은 코드 전 응답에 없다', () => {
  const cards = run([persona(), couple(), beer()]);
  const result = { status: 'ok', place: { id: '123', name: '테스트카츠', category: '돈가스', district: '강남구' }, confidence: 'thin', review_count: 12, cards, extras: { phrases: ['비밀문구'], copy: [], missing: [], when: {} }, extras_status: 'ready' };
  const locked = JSON.stringify(P.publicView(result, false));
  assert.ok(locked.includes(cards[0].scene));
  assert.ok(!locked.includes(cards[1].scene)); assert.ok(!locked.includes('비밀문구'));
  assert.ok(locked.includes(cards[1].nickname), '제목은 보임');
  const v = P.publicView(result, false);
  assert.equal(v.locked, true); assert.equal(v.extras, null); assert.equal(v.cards[1].locked, true);
  const open = JSON.stringify(P.publicView(result, true));
  assert.ok(open.includes(cards[1].scene)); assert.ok(open.includes('비밀문구'));
  assert.equal(P.publicView(result, true).locked, false);
  assert.equal(P.publicView({ ...result, extras: null, extras_status: 'failed' }, true).extras_status, 'failed');
  const few = P.publicView({ status: 'too_few', place: result.place, confidence: 'too_few', review_count: 2, cards: [] }, false);
  assert.equal(few.locked, false); assert.deepEqual(few.cards, []);
});

test('프롬프트: 번호 1~60, 본문 300자 절단, 메뉴 번호 포함', () => {
  const many = Array.from({ length: 61 }, (_, i) => (i === 0 ? '가'.repeat(400) : `리뷰 본문입니다 고유표식${i}번 맛있게 먹었습니다`));
  const f = mkFacts(many); const reviews = P.selectReviews(f, NOW);
  const p = P.buildCardsPrompt(f, reviews);
  assert.ok(/\n1\. /.test(p)); assert.ok(/\n60\. /.test(p)); assert.ok(!/\n61\. /.test(p));
  assert.ok(!p.includes('가'.repeat(301)));
  assert.ok(p.includes('1) 히레카츠'));
});

test('analyzeCards: 상태 분기와 AI 호출 횟수', async () => {
  let calls = 0;
  const good = async () => { calls += 1; return { personas: [persona(), couple(), beer()] }; };
  const r = await P.analyzeCards(mkFacts(), { llm: good, now: NOW });
  assert.equal(r.status, 'ok'); assert.equal(r.cards.length, 2, '12건은 thin → 2장'); assert.equal(r.review_count, 12); assert.equal(r.confidence, 'thin'); assert.equal(calls, 1);
  calls = 0;
  const few = await P.analyzeCards(mkFacts(BODIES.slice(0, 4)), { llm: good, now: NOW });
  assert.equal(few.status, 'too_few'); assert.equal(calls, 0);
  const unread = await P.analyzeCards(mkFacts(BODIES, { reviews: { status: 'missing' } }), { llm: good, now: NOW });
  assert.equal(unread.status, 'unreadable'); assert.equal(calls, 0);
  assert.equal((await P.analyzeCards(mkFacts(), { llm: null, now: NOW })).status, 'failed');
  assert.equal((await P.analyzeCards(mkFacts(), { llm: async () => null, now: NOW })).status, 'failed');
  assert.equal((await P.analyzeCards(mkFacts(), { llm: async () => { throw new Error('boom'); }, now: NOW })).status, 'failed');
  assert.equal((await P.analyzeCards(mkFacts(), { llm: async () => ({ personas: [] }), now: NOW })).status, 'failed');
});

test('analyzeExtras: 실패는 null', async () => {
  const facts = mkFacts(); const cards = run([persona(), couple()]);
  assert.equal(await P.analyzeExtras(facts, cards, { llm: async () => null, now: NOW }), null);
  assert.equal(await P.analyzeExtras(facts, cards, { llm: async () => { throw new Error('x'); }, now: NOW }), null);
  const e = await P.analyzeExtras(facts, cards, { llm: async () => ({ phrases: ['혼밥'], copy: [], missing: [] }), now: NOW });
  assert.deepEqual(e.phrases, ['혼밥']);
});

test('그림 파일: 모든 키에 SVG가 있고 4KB 이하', () => {
  for (const k of P.ILLUSTRATION_KEYS) {
    const f = path.join(__dirname, '..', 'public', 'persona', 'img', k + '.svg');
    const s = fs.readFileSync(f, 'utf8');
    assert.ok(s.startsWith('<svg'), k); assert.ok(s.length <= 4096, `${k} ${s.length}`);
  }
});

// ---------- 코덱스 R2 ----------
test('R2-03 isFoodService: 업종 토큰으로 판정(스파게티는 외식, 목욕탕은 아님)', () => {
  const is = (c) => P.isFoodService(mkFacts(BODIES, { category: val(c), reviewStats: val({ menus: [] }) }));
  for (const c of ['스파게티,파스타전문', '생선회', '칵테일바', '호프,요리주점', '감자탕', '칼국수,만두', '카페,디저트']) assert.equal(is(c), true, c);
  for (const c of ['목욕탕,사우나', '찜질방', '교회', '회사', '네일바', '스파', '면세점', '협회,단체']) assert.equal(is(c), false, c);
});

test('R2-04 막대: 이름에 보이는 낱말로만 센다', () => {
  const f = mkFacts(['점심에 왔어요 든든하게 먹었습니다', '저녁에 왔어요 든든하게 먹었습니다', '회식으로 왔어요 든든하게 먹었습니다', ...BODIES.slice(3)]);
  const c = run([persona({ signals: [{ words: ['점심', '저녁', '회식'] }], review_ids: [1, 2, 3] })], f)[0];
  assert.equal(c.count, 3);
  assert.deepEqual(c.signals, [{ label: '점심·저녁', count: 2 }]);
});

test('R2-05 불만 건수는 아쉬움이 드러난 인용만(문장은 건수 없이 남는다), 별점 낮은 리뷰의 같은 이야기는 인정', () => {
  const f = mkFacts(['점심 음식이 빠르고 친절했습니다 혼밥', '점심 음식이 빠르고 깔끔했습니다 혼밥', '점심에 혼밥하기 좋았습니다 음식이 빨라요', ...BODIES.slice(3)]);
  const ev = [{ review_id: 1, quote: '음식이 빠르고 친절했습니다' }, { review_id: 2, quote: '음식이 빠르고 깔끔했습니다' }];
  const c = run([persona({ review_ids: [1, 2, 3], dislikes: [{ text: '직원이 불친절할 때', evidence: ev }] })], f)[0];
  assert.deepEqual(c.dislikes, [{ text: '직원이 불친절할 때', count: null }], '칭찬 인용으로는 건수가 붙지 않는다');
  const f3 = mkFacts(); f3.reviews.value[0].rating = 2;
  assert.deepEqual(run([persona({ dislikes: [{ text: '자리가 애매할 때', evidence: [{ review_id: 1, quote: '자리가 넓어요' }] }] })], f3)[0].dislikes, [{ text: '자리가 애매할 때', count: 1 }]);
});

test('R2-06 개인정보: 계정 문자열은 신호·막대 이름으로도 나가지 않는다', () => {
  const f = mkFacts(['점심 혼밥 후기는 @alice_test 에 올려요 맛있어요', '혼밥 점심 사진은 @alice_test 계정에 있어요', '점심에 혼밥 @alice_test 팔로우 해주세요', ...BODIES.slice(3)]);
  assert.equal(run([persona({ signals: [{ words: ['@alice_test'] }], review_ids: [1, 2, 3] })], f).length, 0);
  assert.equal(run([persona({ signals: [{ words: ['alice_test'] }], review_ids: [1, 2, 3] })], f).length, 0);
  const cards = run([persona({ signals: [{ words: ['alice_test', '혼밥'] }], review_ids: [1, 2, 3] })], f);
  assert.equal(cards.length, 1);
  const walk = (x) => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(walk) : []);
  for (const s of walk(P.publicView({ status: 'ok', cards }, true))) assert.ok(!P.hasPii(s) && !s.includes('alice'), s);
});

test('R2-08 메뉴 번호는 AI에 보여 준 20번까지만', () => {
  const menus = val(Array.from({ length: 30 }, (_, i) => ({ name: `메뉴${i + 1}`, price: val(String(10000 + i)), order: i })));
  const f = mkFacts(BODIES, { menus });
  assert.equal(P.menuList(f).length, 20);
  assert.equal(run([persona({ menu_no: 20 })], f)[0].menu, '메뉴20');
  assert.equal(run([persona({ menu_no: 21 })], f)[0].menu, null);
  assert.ok(!P.buildCardsPrompt(f, P.selectReviews(f, NOW)).includes('21) '));
});

test('R3-06 불만: 인용이 그 불만과 같은 이야기일 때만 건수를 붙인다', () => {
  const d = (text, quote, id = 4) => run([persona({ dislikes: [{ text, evidence: [{ review_id: id, quote }] }] })])[0].dislikes[0].count;
  assert.equal(d('직원이 불친절할 때', '점심 줄이 길었어요'), null);
  assert.equal(d('점심 줄이 길 때', '점심 줄이 길었어요'), 1);
  assert.equal(d('줄이 길 때', '줄이 길었어요'), 1);
  assert.equal(d('너무 조금 아쉬울 때', '점심 줄이 길었어요'), null, '흔한 꾸밈말만 겹치는 것은 인정하지 않음');
  const f = mkFacts(); f.reviews.value[0].rating = 1;
  assert.equal(run([persona({ dislikes: [{ text: '직원이 불친절할 때', evidence: [{ review_id: 1, quote: '자리가 넓어요' }] }] })], f)[0].dislikes[0].count, null, '별점이 낮아도 다른 이야기면 건수 없음');
});
