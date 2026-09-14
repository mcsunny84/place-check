const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const K = require('../lib/keyword.js');

test('UMD: require and browser global', () => {
  assert.equal(typeof K.diagnoseKeywords, 'function');
  const g = {};
  new Function(fs.readFileSync(path.join(__dirname, '../lib/keyword.js'), 'utf8')).call(g);
  assert.equal(typeof g.PlaceKeyword.extractDistrict, 'function');
});

test('extractDistrict — 06번 §2 + 반례', () => {
  const cases = [
    ['서울특별시 종로구 율곡로 88 2층 205호', '종로구'],
    ['서울특별시 중구 세종대로 10 (태평로1가, A빌딩 101동)', '태평로1가'],
    ['서울특별시 중구 세종대로 10 별관동', '중구'],
    ['경기도 성남시 분당구 판교역로 10', '분당구'],
    ['경기도 양평군 양평읍 중앙로 10', '양평읍'],
    ['세종특별자치시 한누리대로 10', null],
    ['서울특별시 강남구 테헤란로 1 (역삼동)', '역삼동'],
    ['서울특별시 강남구 테헤란로 1 (101동, 역삼동)', '강남구'],
    ['', null],
  ];
  for (const [addr, want] of cases) assert.equal(K.extractDistrict(addr), want, addr);
});

test('stationDisplay', () => {
  assert.equal(K.stationDisplay('서울역(경의중앙선)'), '서울역');
  assert.equal(K.stationDisplay('안국'), '안국역');
  assert.equal(K.stationDisplay('역삼'), '역삼역');
  assert.equal(K.stationDisplay('안국역'), '안국역');
});

test('normalizeCategory', () => {
  assert.deepEqual(K.normalizeCategory('돈가스'), { norm: '돈카츠', suffix: '맛집', supported: true });
  assert.deepEqual(K.normalizeCategory('돈까스'), { norm: '돈카츠', suffix: '맛집', supported: true });
  assert.deepEqual(K.normalizeCategory('커피전문점'), { norm: '카페', suffix: '추천', supported: true });
  assert.deepEqual(K.normalizeCategory('카페,디저트'), { norm: '카페', suffix: '추천', supported: true });
  assert.deepEqual(K.normalizeCategory('일본음식'), { norm: '일식', suffix: '맛집', supported: true });
  assert.deepEqual(K.normalizeCategory('헤어샵'), { norm: '미용실', suffix: '잘하는 곳', supported: true });
  assert.deepEqual(K.normalizeCategory('치과'), { norm: '치과', suffix: '추천', supported: true });
  assert.deepEqual(K.normalizeCategory('교습소'), { norm: '학원', suffix: '추천', supported: true });
  assert.deepEqual(K.normalizeCategory('네일샵'), { norm: '네일샵', suffix: '추천', supported: false });
});

test('menuForKeyword — 명시 장식만 제거', () => {
  assert.equal(K.menuForKeyword('로스카츠(2인)'), '로스카츠');
  assert.equal(K.menuForKeyword('모둠카츠(3인분)'), '모둠카츠');
  assert.equal(K.menuForKeyword('로스카츠 2인 세트'), '로스카츠');
  assert.equal(K.menuForKeyword(' 히레카츠 세트 '), '히레카츠');
  assert.equal(K.menuForKeyword('카레(비건)'), '카레(비건)');
  assert.equal(K.menuForKeyword('카레(일반)'), '카레(일반)');
  assert.equal(K.menuForKeyword('세트 A'), '세트 A');
  assert.equal(K.menuForKeyword('정식'), '정식');
  assert.equal(K.menuForKeyword('세트'), '세트');
});

const ctx = { name: '키세카츠 안국점', district: '안국동', station: '안국', category: '돈가스', menus: ['로스카츠 세트', '히레카츠'] };

test('diagnoseKeywords — 라벨', () => {
  const r = K.diagnoseKeywords(['키세카츠안국점', '돈카츠', '안국역돈카츠', '안국 맛집', '안국역 로스카츠', '안국역 로스카츠', '가', '종로구 도시락'], ctx);
  const L = Object.fromEntries(r.map((x) => [x.keyword, x.labels]));
  assert.ok(L['키세카츠안국점'].includes('브랜드명 단독'));
  assert.deepEqual(L['돈카츠'], ['지역 없음', '너무 넓음']);
  assert.deepEqual(L['안국역돈카츠'], ['좋아요']);
  assert.deepEqual(L['안국 맛집'], ['업종·메뉴 없음']);
  assert.deepEqual(r[4].labels, ['좋아요']);
  assert.equal(r[5].labels.includes('중복'), true);
  assert.equal(r[4].labels.includes('중복'), false);
  assert.ok(L['가'].includes('길이 이상'));
  assert.deepEqual(L['종로구 도시락'], ['업종·메뉴 없음']);
  assert.ok(r.every((x) => x.labels.length >= 1));
});

test('diagnoseKeywords — 미지원 업종은 업종 검사 보류', () => {
  const r = K.diagnoseKeywords(['안국 네일', '네일'], { name: 'X', district: '안국동', category: '네일샵', menus: [] });
  assert.deepEqual(r[0].labels, ['좋아요']);
  assert.deepEqual(r[1].labels, ['지역 없음', '너무 넓음']);
});

test('recommendKeywords — 템플릿 순서·생략·중복·기존 표시', () => {
  const r = K.recommendKeywords({ district: '안국동', station: '안국', categoryNorm: '돈카츠', suffix: '맛집', menus: ['로스카츠 세트', '히레카츠'], situations: ['혼밥', '회식'], existing: ['안국역돈카츠'] });
  assert.deepEqual(r.map((x) => x.keyword), ['안국 돈카츠', '안국역 돈카츠', '안국 맛집', '안국역 맛집', '안국 로스카츠', '안국역 로스카츠', '안국 혼밥 돈카츠', '안국역 혼밥', '안국 돈카츠 추천', '안국 히레카츠']);
  assert.deepEqual(r.map((x) => x.template), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r[1].existing, true);
  assert.equal(r[0].existing, false);
  assert.ok(r.length <= 10);
  // 역·상황·메뉴2 없음 → 해당 템플릿 생략
  const s = K.recommendKeywords({ district: '종로구', categoryNorm: '돈카츠', suffix: '맛집', menus: ['로스카츠'], situations: [], existing: [] });
  assert.deepEqual(s.map((x) => x.keyword), ['종로구 돈카츠', '종로구 맛집', '종로구 로스카츠', '종로구 돈카츠 추천']);
  // 메뉴2 없고 상황2 있으면 템플릿 10 = {역} {상황2}
  const t = K.recommendKeywords({ station: '안국', categoryNorm: '돈카츠', suffix: '맛집', menus: [], situations: ['혼밥', '회식'], existing: [] });
  assert.deepEqual(t.find((x) => x.template === 10), { keyword: '안국역 회식', template: 10, existing: false });
  // 비음식 접미: 맛집 대신 업종 접미, 9번과 중복이면 하나만
  const h = K.recommendKeywords({ district: '안국동', categoryNorm: '미용실', suffix: '잘하는 곳', menus: [], situations: [], existing: [] });
  assert.deepEqual(h.map((x) => x.keyword), ['안국 미용실', '안국 미용실 잘하는 곳', '안국 미용실 추천']);
  const c = K.recommendKeywords({ district: '안국동', categoryNorm: '카페', suffix: '추천', menus: [], situations: [], existing: [] });
  assert.deepEqual(c.map((x) => x.keyword), ['안국 카페', '안국 카페 추천']);
  assert.deepEqual(K.recommendKeywords({}), []);
});

test('menuForKeyword — 세트 조합·옵션 괄호 제거, 의미 괄호 보존', () => {
  const K = require('../lib/keyword');
  assert.equal(K.menuForKeyword('히레카츠 + 면요리세트(우동/소바)'), '히레카츠');
  assert.equal(K.menuForKeyword('브리스킷 듀오 플래터(2인)'), '브리스킷 듀오 플래터');
  assert.equal(K.menuForKeyword('카레(비건)'), '카레(비건)');
});
