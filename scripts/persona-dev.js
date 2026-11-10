'use strict';
// 손님 카드 화면 개발용 서버 — 네이버·AI 없이 가짜 매장 1곳으로 흐름을 본다. 운영에서는 쓰지 않는다.
//   node scripts/persona-dev.js            → http://localhost:8091/persona  (코드 1234)
//   넣을 주소: https://m.place.naver.com/restaurant/900000001/home (카드 3장) · …/900000002/home (리뷰 부족) · …/900000003/home (미용실)
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const TMP = path.join(os.tmpdir(), 'place-check-persona-dev');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.PORT = process.env.PORT || '8091';
process.env.PLACE_CACHE_DIR = path.join(TMP, 'cache');
process.env.PLACE_STATS_FILE = path.join(TMP, 'cache', 'coupons.jsonl');
process.env.PERSONA_DIR = path.join(TMP, 'persona');
process.env.PLACE_USAGE_FILE = path.join(TMP, 'usage.jsonl');
process.env.PERSONA_CODES = process.env.PERSONA_CODES || '1234';
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server');

const val = (x) => ({ status: 'value', value: x });
const A = ['점심에 혼자 가기 좋아요. 자리가 넓어서 눈치 안 보여요.', '회사 근처라 점심에 자주 와요. 혼밥하기 편합니다.', '혼밥하기 좋은 1인석이 있어서 점심마다 들러요.', '혼자 와서 히레카츠 정식 먹었습니다. 점심 줄이 조금 길었어요.', '퇴근하고 혼자 저녁 먹기 좋은 곳. 히레가 부드러워요.', '점심시간에 혼밥하러 왔는데 금방 나와서 좋았어요.', '회사 동기 추천으로 혼자 와봤는데 점심 메뉴로 딱입니다.'];
const B = ['여자친구랑 데이트하다 들렀어요. 미소카츠가 색달라요.', '남편이랑 주말 데이트 겸 왔는데 분위기가 좋았습니다.', '데이트 코스로 추천해요. 사진 찍기 좋아요.', '남자친구랑 미소카츠 세트 나눠 먹었어요. 데이트 성공!', '연인끼리 오기 좋은 자리. 미소카츠는 조금 달았어요.'];
const C = ['퇴근하고 동료들이랑 맥주 한잔 했습니다. 가라아게 최고.', '맥주가 음식보다 먼저 나와서 조금 아쉬웠어요. 회식 장소로는 괜찮아요.', '동료들과 회식으로 왔어요. 맥주랑 김치카츠나베 조합이 좋습니다.', '팀 회식으로 방문. 맥주 안주로 가라아게를 시켰어요.'];
const D = ['그냥 맛있어요 또 올게요 정말 맛있습니다', '친절하고 깔끔한 매장이라 만족했습니다', '바삭하고 두툼해서 좋았어요 추천합니다'];
const bodies = [...A, ...B, ...C, ...D];
const now = Date.now();
const day = (i) => new Date(now - (i * 3 + 2) * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
function facts(id, over = {}) {
  return {
    placeId: val(String(id)), name: val('키세카츠 견본점'), category: val('돈가스'), placeType: 'restaurant', district_tokens: val(['강남구', '강남대로']),
    menus: val([{ name: '히레카츠 정식', price: val('14900'), order: 0 }, { name: '나고야 미소카츠', price: val('15900'), order: 1 }, { name: '가라아게', price: val('8900'), order: 2 }]),
    reviewStats: val({ totalCount: 412, avgRating: 4.7, menus: [{ name: '히레카츠', count: 60 }], votedKeywords: [{ name: '음식이 맛있어요', count: 300 }, { name: '혼밥하기 좋아요', count: 120 }, { name: '친절해요', count: 110 }], votedTotal: 900, themes: [] }),
    reviews: val(bodies.map((b, i) => ({ id: `${id}-${i}`, body: b, rating: i % 7 === 3 ? 4 : 5, visited: day(i), created: day(i), votedKeywords: [], visitCategories: i < 7 ? ['혼자'] : i < 12 ? ['연인・배우자'] : [] }))),
    fetched_at: new Date(now).toISOString(), ...over,
  };
}
srv.writeCache('900000001', facts('900000001'));
const few = facts('900000002'); few.reviews.value = few.reviews.value.slice(0, 3); srv.writeCache('900000002', few);
srv.writeCache('900000003', facts('900000003', { name: val('견본 헤어'), category: val('미용실') }));

const find = (reviews, re) => reviews.filter((r) => re.test(r)).map((r) => Number(r.match(/^(\d+)\./)[1]));
srv.state.llmPersona = async (kind, prompt) => {
  await new Promise((r) => setTimeout(r, kind === 'cards' ? 4000 : 6000));
  const lines = prompt.split('\n').filter((l) => /^\d+\. \[/.test(l));
  const quote = (re) => { const l = lines.find((x) => re.test(x)); return l ? { review_id: Number(l.match(/^(\d+)\./)[1]), text: l.replace(/^\d+\. \[[^\]]*\] /, '').split('. ')[0].replace(/\.$/, '') } : null; };
  if (kind === 'extras') return { phrases: ['혼밥하기 좋아요', '점심', '1인석', '데이트 코스', '미소카츠', '가라아게', '회식', '눈치 안 보여요', '지역 1위 맛집'], copy: [1, 2, 3].map((p) => ({ persona: p, news: '이번 주 점심에는 1인석을 넉넉히 비워 둘게요. 주문하면 금방 나와요.', reply: '혼자 편하게 드셨다니 다행이에요. 다음 점심에도 자리 비워 둘게요.', insta: '혼자 와도 편한 1인석. 점심 한 끼 든든하게 드시고 가세요.' })), missing: [{ who: '아이와 오는 가족', why: '리뷰에 아이·가족 이야기가 거의 없어요.', how: '아이용 작은 접시와 좌석 사진을 소식에 올려 보세요.' }] };
  const q1 = quote(/눈치 안 보여요/), q2 = quote(/혼밥하기 좋은 1인석/), q3 = quote(/데이트하다/), q4 = quote(/맥주 한잔/);
  return { personas: [
    { nickname: '점심 혼밥 직장인 민준 씨', group: 'solo', gender: 'male', age: '30s', who: '30대 초반 · 근처 회사원', scene: '평일 점심이나 퇴근길에 혼자 옵니다. 회사에서 가깝고 1인석이 있어서, 금방 먹고 나갈 수 있는 곳으로 기억해요.', signals: [{ words: ['혼밥', '혼자'] }, { words: ['점심'] }, { words: ['회사'] }], review_ids: find(lines, /혼밥|혼자|회사/), menu_no: 1, likes: ['눈치 안 보이는 1인석', '주문하면 금방 나오는 것', '부드러운 히레'], dislikes: [{ text: '점심 줄이 길 때', evidence: [{ review_id: find(lines, /줄이 조금 길었어요/)[0], quote: '점심 줄이 조금 길었어요' }] }], quotes: [q1, q2].filter(Boolean), group_evidence: [], demo_evidence: [{ review_id: find(lines, /회사 근처라/)[0], quote: '회사 근처라 점심에 자주 와요' }, { review_id: find(lines, /회사 동기/)[0], quote: '회사 동기 추천으로' }], line: '신논현역 5분, 혼자 와도 편한 1인석이 있어요.' },
    { nickname: '데이트 중 들른 커플 지현 씨', group: 'couple', gender: 'mixed', age: '20s', who: '20~30대 · 데이트 중', scene: '주말에 데이트하다 색다른 카츠를 찾아 들릅니다. 미소카츠를 나눠 먹고 사진을 남겨요.', signals: [{ words: ['데이트'] }, { words: ['미소카츠'] }], review_ids: find(lines, /데이트|연인|남자친구/), menu_no: 2, likes: ['사진 찍기 좋은 자리', '나눠 먹는 세트'], dislikes: [{ text: '미소카츠가 달게 느껴질 때', evidence: [{ review_id: find(lines, /조금 달았어요/)[0], quote: '미소카츠는 조금 달았어요' }] }], quotes: [q3].filter(Boolean), group_evidence: [], demo_evidence: [], line: '둘이 나눠 먹기 좋은 미소카츠 세트가 있어요.' },
    { nickname: '퇴근 후 한잔 모임 성호 씨', group: 'coworkers', gender: 'unknown', age: 'unknown', who: '직장 동료 서너 명', scene: '평일 저녁에 동료들과 옵니다. 가라아게와 나베에 맥주를 곁들여요.', signals: [{ words: ['맥주'] }, { words: ['회식', '동료'] }], review_ids: find(lines, /맥주|회식|동료들/), menu_no: 3, likes: ['맥주 안주가 되는 메뉴'], dislikes: [{ text: '맥주가 음식보다 먼저 나올 때', evidence: [{ review_id: find(lines, /먼저 나와서/)[0], quote: '맥주가 음식보다 먼저 나와서' }] }], quotes: [q4].filter(Boolean), group_evidence: [{ review_id: find(lines, /동료들이랑/)[0], quote: '동료들이랑 맥주 한잔' }, { review_id: find(lines, /동료들과 회식/)[0], quote: '동료들과 회식으로 왔어요' }], demo_evidence: [], line: '퇴근길 한잔에 어울리는 가라아게와 나베가 있어요.' },
  ] };
};
srv.createServer().listen(Number(process.env.PORT), () => console.log(`persona dev http://localhost:${process.env.PORT}/persona (code ${process.env.PERSONA_CODES})`));
