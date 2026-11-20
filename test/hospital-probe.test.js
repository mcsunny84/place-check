'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../lib/hospital/probe');
const PL = require('../lib/hospital/places');
const B = require('../lib/hospital/budget');
const os = require('os'); const fs = require('fs'); const path = require('path');

// 2026-11-19 실측 API 답(gpt-6.2-sol, 검색 결과 짧게)에서 그대로 옮긴 글
const HONGDAE = '홍대입구역 근처라면 **여드름·흉터 상담은 새솔피부과**, **가려움·발진처럼 원인 진단이 먼저라면 윤슬피부과나 연세피부과**를 먼저 알아보세요. 세 곳 모두 피부과 전문의가 있는 곳으로 확인돼요. ([mindskin.co.kr](https://mindskin.co.kr/ko?utm_source=openai))\n\n- **새솔피부과의원** — 홍대입구역 **8번 출구** 근처. 피부과 전문의 2명이 진료해요.\n- **윤슬피부과의원 / 연세피부과의원** — 둘 다 동교동에 있어요.';
const NOWON = '**노원역 근처에서 충치나 스케일링으로 가실 거라면 바른숲치과의원**을 먼저 알아보세요.\n\n| 이런 경우라면 | 추천 후보 |\n|---|---|\n| **치아교정 상담** | **햇살치과교정과 치과병원** — 노원역 근처 |\n| **월·금 퇴근 후 진료** | **가온치과병원** — 오후 9시까지 |\n| **월계역이 더 가까운 경우** | **노원한빛제일치과** — 월계역 3번 출구 |';

test('진료과·지역 판정', () => {
  assert.deepStrictEqual(P.deptOf('피부과').dept, '피부과');
  assert.strictEqual(P.deptOf('치과의원').dept, '치과');
  assert.strictEqual(P.deptOf('카페'), null);
  assert.deepStrictEqual(P.regionsOf('서울 노원구 상계동 · 서울 노원구 동일로 1414'), ['노원', '상계동']);
  assert.deepStrictEqual(P.regionsOf('경기 성남시 분당구 정자동'), ['분당', '정자동']);
  assert.deepStrictEqual(P.regionsOf('대전 서구 둔산동'), ['대전 서구', '둔산동']);
  assert.deepStrictEqual(P.regionsOf('부산 부산진구 부전동'), ['부산진', '부전동']);
  assert.deepStrictEqual(P.regionsOf('경기 수원시 팔달구 인계동'), ['팔달', '인계동']);
  assert.deepStrictEqual(P.regionsOf(''), []);
});

test('질문 5개, 병원 이름은 들어가지 않는다', () => {
  const q = P.buildQuestions(['노원', '상계동'], P.deptOf('치과'));
  assert.strictEqual(q.length, 5);
  assert.ok(q.includes('노원 치과 추천해줘') && q.includes('상계동 치아교정 잘하는 곳 알려줘'));
  assert.strictEqual(P.buildQuestions(['홍대'], P.deptOf('피부과')).length, 5);
});

test('답에서 병원 이름 뽑기 — 실측 글', () => {
  const h = P.extractClinics(HONGDAE).map((c) => c.key);
  assert.deepStrictEqual(h.slice(0, 3), ['새솔피부과', '윤슬피부과', '연세피부과']);
  assert.ok(!h.includes('피부과'), '일반 단어는 병원으로 세지 않는다');
  const n = P.extractClinics(NOWON).map((c) => c.name);
  assert.ok(n.includes('바른숲치과의원') && n.includes('가온치과병원') && n.includes('노원한빛제일치과'));
});

test('우리 병원 찾기 — 이름 변형(의원·지점명)', () => {
  const ans = { text: HONGDAE, sources: [{ url: 'https://mindskin.co.kr/ko' }] };
  const j = P.judge(ans, { name: '새솔피부과의원 홍대점', host: 'mindskin.co.kr' });
  assert.strictEqual(j.found, true); assert.strictEqual(j.rank, 1); assert.strictEqual(j.ourSource, true);
  assert.ok(!j.others.some((x) => P.keyOf(x) === '새솔피부과'));
  const miss = P.judge(ans, { name: '소담봄의원', host: null });
  assert.strictEqual(miss.found, false); assert.strictEqual(miss.rank, null);
});

test('출처 종류', () => {
  assert.strictEqual(P.sourceKind('https://doctornow.co.kr/hospitals/x'), '닥터나우');
  assert.strictEqual(P.sourceKind('https://www.modoodoc.com/hospital/1'), '모두닥');
  assert.strictEqual(P.sourceKind('https://oreundental.com/', 'oreundental.com'), '우리 홈페이지');
});

function deps(over = {}) {
  const m = new Map(); let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({ usage: { input_tokens: 9000, output_tokens: 500 }, output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: HONGDAE, annotations: [{ url: 'https://mindskin.co.kr/ko?utm_source=openai', title: '새솔' }] }] }] }) }; };
  return { d: { fetch: fakeFetch, env: { OPENAI_API_KEY: 'x' }, usdKrw: 1450, cache: { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }, budget: { reserve: () => true, settle: () => {} }, now: () => 1_800_000_000_000, ...over }, calls: () => calls };
}

test('실측 흐름: 추천률·경쟁 병원·공유 결과', async () => {
  const { d, calls } = deps();
  const r = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, d);
  assert.strictEqual(r.ok, true); assert.strictEqual(r.asked, 5); assert.strictEqual(r.hits, 5);
  assert.strictEqual(r.rows[0].rank, 2);
  assert.strictEqual(r.rivals[0].name, '새솔피부과');
  assert.ok(r.spent_krw > 0);
  assert.strictEqual(calls(), 6, '질문 5개 + 병원 이름 질문 1개');
  const again = await P.runProbe({ name: '연세피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, d);
  assert.strictEqual(calls(), 7, '같은 지역 두 번째 병원은 이름 질문 1개만 새로 묻는다');
  assert.ok(again.spent_krw > 0 && again.spent_krw < r.spent_krw); assert.strictEqual(again.rows[0].rank, 3);
});

test('예산이 다 차면 부르지 않는다', async () => {
  const { d, calls } = deps({ budget: { reserve: () => false, settle: () => {} } });
  const r = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과' }, d);
  assert.deepStrictEqual([r.ok, r.reason, calls()], [false, 'budget', 0]);
});

test('API 오류면 지어내지 않는다', async () => {
  const { d } = deps({ fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const r = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과' }, d);
  assert.deepStrictEqual([r.ok, r.reason], [false, 'api']);
});

test('예산 장부: 월·일 상한, 재시작 뒤에도 이어짐', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')), 's.json');
  let t = Date.UTC(2026, 10, 19, 3);
  const b = B.create({ file, now: () => t, monthlyKrw: 1000, dailyKrw: 300 });
  assert.ok(b.reserve(200)); b.settle(250, 200);
  assert.ok(!b.reserve(60), '오늘 300원 넘김');
  t += 24 * 3600e3;
  assert.ok(b.reserve(60)); b.settle(60, 60);
  const b2 = B.create({ file, now: () => t, monthlyKrw: 1000, dailyKrw: 300 });
  assert.strictEqual(b2.status().krw, 310);
  t = Date.UTC(2026, 11, 2);
  assert.strictEqual(b2.status().krw, 0, '달이 바뀌면 새로');
});

test('구글 지도 판정: 영어 화면 이름·진료과 단어, 세부 분류는 치과만', () => {
  // 2026-11-19 실제 조회 값
  const sdbom = PL.classify({ displayName: { text: '소담봄의원' }, primaryType: 'doctor', types: ['doctor', 'skin_care_clinic'] }, '피부과', 'sdbom clinic');
  assert.deepStrictEqual([sdbom.shownName, sdbom.hangul, sdbom.inName, sdbom.category], ['sdbom clinic', false, false, 'unverifiable']);
  const mind = PL.classify({ displayName: { text: '새솔피부과의원' }, primaryType: 'doctor', types: ['doctor'] }, '피부과', '새솔피부과의원');
  assert.deepStrictEqual([mind.hangul, mind.inName, mind.category], [true, true, 'unverifiable']);
  assert.strictEqual(PL.classify({ displayName: { text: '튼튼플란트치과' }, types: ['dental_clinic'] }, '치과', "Chan's plant dental clinic").category, 'match');
  assert.strictEqual(PL.classify({ displayName: { text: '바른숲치과의원' }, types: ['doctor'] }, '치과', null).category, 'other');
});

test('구글 지도 조회: 한국어로 맞추고 영어 이름 한 번 더·캐시', async () => {
  const m = new Map(); const urls = [];
  const d = { env: { GOOGLE_PLACES_API_KEY: 'k' }, now: () => 1, cache: { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }, budget: { reserve: () => true, settle: () => {} },
    fetch: async (u) => { urls.push(u); return u.includes('searchText')
      ? { status: 200, json: async () => ({ places: [{ id: 'x1', displayName: { text: '다른치과' } }, { id: 'p9', displayName: { text: '바른숲치과의원' }, types: ['dentist'], rating: 4.8, userRatingCount: 120 }] }) }
      : { status: 200, json: async () => ({ displayName: { text: 'Oreun Dental Clinic' } }) }; } };
  const r = await PL.lookup({ name: '바른숲치과의원', address: '서울 노원구 상계동', dept: '치과' }, d);
  assert.deepStrictEqual([r.found, r.category, r.reviews, r.shownName, r.hangul, r.inName], [true, 'match', 120, 'Oreun Dental Clinic', false, true]);
  assert.ok(urls[1].includes('/places/p9?languageCode=en'));
  await PL.lookup({ name: '바른숲치과의원', address: '서울 노원구 상계동', dept: '치과' }, d);
  assert.strictEqual(urls.length, 2);
  const none = await PL.lookup({ name: 'x', address: '', dept: '치과' }, { ...d, env: {} });
  assert.strictEqual(none.reason, 'no_key');
});

test('학회 이름·일반 명칭은 병원으로 세지 않는다', () => {
  const n = P.extractClinics('**대한성형외과학회에서 전문의 확인** 그리고 **햇살치과교정과 치과병원**').map((c) => c.key);
  assert.deepStrictEqual(n, ['햇살치과']);
});

test('지점 이름이 붙은 병원도 우리 병원으로 알아본다 (11-19 실측 오판)', () => {
  assert.strictEqual(P.coreOf('구름성형외과의원 부산서면역'), '구름');
  assert.strictEqual(P.coreOf('소담봄의원 홍대'), '소담봄');
  const j = P.judge({ text: '**눈매성형외과**, **오월성형외과**, **구름성형외과**', sources: [] }, { name: '구름성형외과의원 부산서면역' });
  assert.deepStrictEqual([j.found, j.rank], [true, 3]);
  assert.ok(!j.others.includes('구름성형외과'));
  assert.strictEqual(P.sourceKind('https://www.youtube.com/watch?v=1'), '유튜브');
  assert.strictEqual(P.sourceKind('https://dentalindexing.com/a'), '병원 목록 사이트');
});

// ---- 코덱스 검증(2026-11-19) 지적 사항 ----
test('코덱스 1·2·3·4: 이름 판정 — 일부만 같은 병원, "이"로 시작하는 이름, 글 순서, 붙여 쓴 지점명', () => {
  const a = P.judge({ text: '**라온미소치과**가 가까워요.', sources: [] }, { name: '라온치과의원' });
  assert.strictEqual(a.found, false, '라온미소치과 ≠ 라온치과');
  assert.ok(P.extractClinics('이안치과도 있어요').some((c) => c.key === '이안치과'));
  const b = P.judge({ text: '먼저 가온치과병원이 있고, 그다음 **바른숲치과의원**이에요.', sources: [] }, { name: '바른숲치과의원' });
  assert.deepStrictEqual([b.found, b.rank], [true, 2]);
  assert.strictEqual(P.coreOf('가나의원강남점'), P.coreOf('가나의원'));
});

test('코덱스 6: 실패·빈 답은 결과로 쓰지 않는다', async () => {
  const bad = (body) => deps({ fetch: async () => ({ ok: true, status: 200, json: async () => body }) }).d;
  const r1 = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, bad({ status: 'failed', output: [] }));
  assert.strictEqual(r1.ok, false);
  const r2 = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, bad({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '' }] }] }));
  assert.strictEqual(r2.ok, false);
});

test('코덱스 7·8: 지역 — 숫자 붙은 동, 도시는 캐시 열쇠에', async () => {
  assert.deepStrictEqual(P.regionsOf('서울 강남구 역삼1동'), ['강남', '역삼동']);
  assert.strictEqual(P.regionsOf('서울 종로구 종로3가')[1], '종로3가');
  assert.strictEqual(P.cityOf('부산 해운대구 우동'), 'Busan');
  assert.strictEqual(P.cityOf('경기 성남시'), null);
  const { d, calls } = deps();
  await P.runProbe({ name: '윤슬피부과의원', address: '서울 중구 명동', category: '피부과', regions: ['중구'] }, d);
  await P.runProbe({ name: '윤슬피부과의원', address: '부산 중구 남포동', category: '피부과', regions: ['중구'] }, d);
  assert.strictEqual(calls(), 12, '서울 중구와 부산 중구는 같은 답을 나눠 쓰지 않는다');
});

test('코덱스 10·11·12: 같은 질문 동시 요청은 한 번, 예약은 최대치, 시간 초과는 예약액으로 정산', async () => {
  const { d, calls } = deps();
  const inp = { name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] };
  await Promise.all([P.runProbe(inp, d), P.runProbe({ ...inp, name: '연세피부과의원' }, d)]);
  assert.strictEqual(calls(), 7, '공통 질문 5개는 한 번씩, 이름 질문은 병원마다');
  const log = []; let body;
  const t = deps({ budget: { reserve: (k) => { log.push(['r', k]); return true; }, settle: (a, r) => log.push(['s', a, r]) },
    fetch: async (u, init) => { body = JSON.parse(init.body); const e = new Error('t'); e.name = 'AbortError'; throw e; } }).d;
  await P.runProbe(inp, t);
  assert.strictEqual(body.max_output_tokens, 1200);
  assert.deepStrictEqual(log[0], ['r', P.RESERVE_KRW]);
  assert.ok(log.some((x) => x[0] === 's' && x[1] === P.RESERVE_KRW), '돈이 나갔는지 모르면 예약액으로 친다');
});

test('코덱스 5·9·16: 지도 — 이름이 똑같은 곳 먼저, 진료과 바꿔도 맞게, 영어 이름 실패는 "모름"·보관 안 함', async () => {
  const m = new Map(); let n = 0, enFail = true;
  const d = { env: { GOOGLE_PLACES_API_KEY: 'k' }, now: () => 1, cache: { get: (k) => m.get(k), set: (k, v) => m.set(k, v) }, budget: { reserve: () => true, settle: () => {} },
    fetch: async (u) => { n++; return u.includes('searchText')
      ? { status: 200, json: async () => ({ places: [{ id: 'a', displayName: { text: '라온치과 강남점' } }, { id: 'b', displayName: { text: '라온치과' }, types: ['dentist'] }] }) }
      : enFail ? { status: 500, json: async () => null } : { status: 200, json: async () => ({ displayName: { text: 'Raon Dental' } }) }; } };
  const r = await PL.lookup({ name: '라온치과', address: '서울 강남구', dept: '치과' }, d);
  assert.deepStrictEqual([r.name, r.enChecked, r.hangul, r.inName], ['라온치과', false, null, null]);
  assert.strictEqual(m.size, 0, '영어 이름을 못 받았으면 보관하지 않는다');
  enFail = false;
  const r2 = await PL.lookup({ name: '라온치과', address: '서울 강남구', dept: '치과' }, d);
  assert.deepStrictEqual([r2.enChecked, r2.category], [true, 'match']);
  const r3 = await PL.lookup({ name: '라온치과', address: '서울 강남구', dept: '피부과' }, d);
  assert.strictEqual(r3.category, 'unverifiable', '보관분이어도 진료과는 요청마다 다시 판정');
  assert.strictEqual(n, 4);
});

test('코덱스 13: 장부가 깨졌거나 저장이 안 되면 돈 드는 호출을 막는다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  const file = path.join(dir, 's.json'); fs.writeFileSync(file, '{깨짐');
  const b = B.create({ file, now: () => Date.UTC(2026, 10, 19), monthlyKrw: 1000 });
  assert.strictEqual(b.reserve(10), false); assert.strictEqual(b.status().broken, true);
  const ok = B.create({ file: path.join(dir, 'new.json'), now: () => Date.UTC(2026, 10, 19), monthlyKrw: 1000 });
  assert.strictEqual(ok.reserve(10), true);
});

// ---- 결과 보강(2026-11-19 태양 승인 시안 v3) ----
test('A: 병원 이름 질문 — 모른다고 한 문장·같이 권한 병원, 추천률에는 안 넣음', async () => {
  const INTRO = '봄빛피부과의원은 홍대입구역 근처 피부과예요. 후기에서는 친절한 상담이 자주 언급돼요. 다만 **피부과 전문의가 진료하는지는 공개된 자료에서 확인되지 않았어요.** 대표 시술이나 가격 정보도 찾기 어려워요. 리프팅이 목적이라면 근처의 **마루피부과**도 함께 비교해 보세요. ([modoodoc.com](https://www.modoodoc.com/h/1?utm_source=openai))';
  const qs = [];
  const { d } = deps({ fetch: async (u, init) => { const q = JSON.parse(init.body).input; qs.push(q);
    const text = q.includes('봄빛') ? INTRO : HONGDAE;
    return { ok: true, status: 200, json: async () => ({ status: 'completed', usage: { input_tokens: 9000, output_tokens: 500 }, output: [{ type: 'message', content: [{ type: 'output_text', text, annotations: [] }] }] }) }; } });
  const r = await P.runProbe({ name: '봄빛피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, d);
  assert.ok(qs.includes('홍대 봄빛피부과의원 어때?'));
  assert.strictEqual(r.asked, 5);
  assert.deepStrictEqual(r.intro.gaps.map((g) => g.topic), ['전문의·의료진', '가격·비용', '대표 시술·진료']);
  assert.deepStrictEqual(r.intro.others, ['마루피부과']);
  assert.ok(!r.intro.text.includes('**') && !r.intro.text.includes('modoodoc.com'), '굵은 표시·출처 꼬리는 뗀 글');
  assert.strictEqual(r.intro.unknown, false);
});

test('A: 이름 질문이 예산·오류로 빠져도 실측은 그대로', async () => {
  let n = 0;
  const { d } = deps({ budget: { reserve: () => ++n <= 5, settle: () => {} } });
  const r = await P.runProbe({ name: '윤슬피부과의원', address: '서울 마포구 동교동', category: '피부과', regions: ['홍대'] }, d);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.asked + (r.intro ? 1 : 0), 5, '예약 5번까지만 — 하나는 빠진다');
});

test('B: 가장 많이 나온 병원과 나란히 — 추천 수, 이름이 든 출처', () => {
  const asked = [
    { state: 'missing', sources: [{ url: 'https://maruskin.co.kr/doctor', title: '마루피부과 의료진', kind: '병원 홈페이지' }, { url: 'https://youtube.com/watch?v=1', title: '마루피부과 원장 리프팅', kind: '유튜브' }] },
    { state: 'found', sources: [{ url: 'https://bombit.kr/', title: '봄빛 피부과', kind: '우리 홈페이지' }, { url: 'https://blog.naver.com/x', title: '홍대 피부과 모음', kind: '네이버 블로그' }] },
  ];
  const c = P.compareTop(asked, { name: '봄빛피부과의원', host: 'bombit.kr' }, 1, [{ name: '마루피부과', n: 2 }, { name: '연세피부과', n: 1 }]);
  assert.deepStrictEqual([c.oursTop, c.rival.name, c.rival.hits, c.rival.cited.n, c.ours.cited.n], [false, '마루피부과', 2, 2, 1]);
  assert.deepStrictEqual(c.rival.cited.kinds.map((k) => k.kind).sort(), ['유튜브', '홈페이지']);
  assert.strictEqual(P.compareTop(asked, { name: '봄빛피부과의원' }, 3, [{ name: '마루피부과', n: 2 }]).oursTop, true);
  assert.strictEqual(P.compareTop(asked, { name: '봄빛피부과의원' }, 0, []), null);
});

test('실측 11-20: 일반 조언은 빈칸이 아니고, "판단하기 어려워요"는 빈칸이다', () => {
  const a = { text: '지금 확인한 바로는 ‘마포 소담봄의원’이라는 이름으로 홍대 쪽 병원 정보나 후기를 찾지 못했어요. 미용 시술이라면 추가 비용까지 포함한 총액이 얼마인지 먼저 확인해 보세요.', sources: [] };
  const r = P.readIntro(a, { name: '소담봄의원 홍대' });
  assert.deepStrictEqual(r.gaps.map((g) => g.topic), ['후기']);
  assert.strictEqual(r.unknown, true);
  const b = { text: '산들예치과병원은 2004년에 개설된 치과병원이에요. 다만 담당 의료진별 후기나 진료 만족도까지는 판단하기 어려워요.', sources: [{ url: 'https://x.go.kr/a.pdf', title: '의약과  \nMedical' }] };
  const s = P.readIntro(b, { name: '산들예치과병원' });
  assert.deepStrictEqual(s.gaps.map((g) => g.topic), ['전문의·의료진', '후기']);
  assert.strictEqual(s.unknown, false);
  assert.strictEqual(s.sources[0].title, '의약과 Medical');
});

test('실측 11-20: 비교 상대는 진료과 이름 없는 큰 병원을 건너뛴다', () => {
  const rivals = [{ name: '상계중앙병원', n: 3 }, { name: '노원한국대학교병원', n: 2 }, { name: '가온치과병원', n: 2 }];
  const c = P.compareTop([], { name: '산들예치과병원' }, 1, rivals, '치과');
  assert.strictEqual(c.rival.name, '가온치과병원');
  assert.strictEqual(c.clinicOnly, true);
  assert.strictEqual(P.compareTop([], { name: 'x' }, 0, [{ name: '상계중앙병원', n: 3 }], '치과').rival.name, '상계중앙병원');
  assert.strictEqual(P.compareTop([], { name: 'x' }, 0, [{ name: '마루피부과', n: 2 }], '피부과').clinicOnly, false);
});
