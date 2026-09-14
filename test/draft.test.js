const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../lib/draft.js');

test('UMD: require and browser global', () => {
  assert.equal(typeof D.buildDraft, 'function');
  const g = {};
  new Function(fs.readFileSync(path.join(__dirname, '../lib/draft.js'), 'utf8')).call(g);
  assert.equal(typeof g.PlaceDraft.particle, 'function');
});

test('particle — 받침 있음/없음/영문', () => {
  assert.equal(D.particle('키세카츠', '은는'), '는');
  assert.equal(D.particle('안국점', '은는'), '은');
  assert.equal(D.particle('로스카츠', '을를'), '를');
  assert.equal(D.particle('국밥', '을를'), '을');
  assert.equal(D.particle('카레', '이가'), '가');
  assert.equal(D.particle('정식', '이가'), '이');
  assert.equal(D.particle('Kisekatsu', '은는'), '은');
  assert.equal(D.particle('세트 A', '을를'), '을');
  assert.equal(D.particle('', '이가'), '이');
});

const full = {
  name: '키세카츠 안국점', station: '안국', district: '안국동', categoryNorm: '돈카츠',
  menus: [{ name: '로스카츠', price: 19900 }, { name: '카레(비건)', price: '12000' }],
  hours: '11:00~21:00', closed: '매주 월요일', parking: '건물 지하 주차장 1시간 무료',
  booking: 'naver', phone: '02-000-0000', takeout: true, delivery: false, group: true,
  accessor: '안국역 1번 출구에서 도보 3분', brag: '300시간 숙성한 돼지고기를 씁니다',
};

test('buildDraft — 전체 입력', () => {
  const t = D.buildDraft(full);
  const blocks = t.split('\n\n');
  assert.equal(blocks[0], '키세카츠 안국점은 안국역 인근 안국동에 있는 돈카츠 전문점입니다. 대표 메뉴는 로스카츠(19,900원), 카레(비건)(12,000원)입니다.');
  assert.equal(blocks[1], 'Q. 안국동에서 돈카츠 어디가 좋아요?\nA. 키세카츠 안국점은 로스카츠를 제공합니다. 영업시간은 11:00~21:00입니다. 휴무는 매주 월요일입니다.');
  assert.equal(blocks[2], 'Q. 주차 되나요?\nA. 건물 지하 주차장 1시간 무료.');
  assert.equal(blocks[3], 'Q. 예약 가능한가요?\nA. 네이버 예약으로 예약할 수 있어요.');
  assert.equal(blocks[4], 'Q. 포장이나 배달 되나요?\nA. 포장은 가능합니다. 배달은 하지 않습니다.');
  assert.equal(blocks[5], 'Q. 단체도 되나요?\nA. 단체 이용도 가능합니다. 인원이 많으면 미리 연락 주세요.');
  assert.equal(blocks[6], 'Q. 안국역에서 어떻게 가요?\nA. 안국역 1번 출구에서 도보 3분.');
  assert.equal(blocks[7], '300시간 숙성한 돼지고기를 씁니다.');
  assert.equal(blocks.length, 8);
  for (const bad of ['직접 조리', '최고', '보장', '1위', '가까운']) assert.ok(!t.includes(bad), bad);
});

test('buildDraft — 빈 입력 문단 생략', () => {
  const t = D.buildDraft({ name: '가게', categoryNorm: '카페', menus: [] });
  assert.equal(t, '가게는 카페 전문점입니다.');
  assert.ok(!t.includes('Q.'));
  // 역만 있고 동네 없음 → Q1은 역 이름, 영업시간 없으면 문장 없음
  const s = D.buildDraft({ name: '가게', station: '안국역', categoryNorm: '카페', menus: [{ name: '라떼' }] });
  assert.ok(s.includes('가게는 안국역 인근에 있는 카페 전문점입니다. 대표 메뉴는 라떼입니다.'));
  assert.ok(s.includes('Q. 안국역에서 카페 어디가 좋아요?\nA. 가게는 라떼를 제공합니다.'));
  assert.ok(!s.includes('영업시간'));
});

test('buildDraft — 예약·포장 분기', () => {
  assert.ok(D.buildDraft({ name: 'X', booking: 'phone', phone: '02-1' }).includes('A. 전화(02-1)로 문의해 주세요.'));
  assert.ok(!D.buildDraft({ name: 'X', booking: 'phone' }).includes('예약'));
  assert.ok(!D.buildDraft({ name: 'X', booking: null }).includes('예약'));
  assert.ok(D.buildDraft({ name: 'X', delivery: true }).includes('A. 배달도 가능합니다.'));
  assert.ok(!D.buildDraft({ name: 'X', group: false }).includes('단체'));
  assert.ok(D.buildDraft({ name: 'X', accessor: '골목 안쪽' }).includes('Q. 어떻게 찾아가요?\nA. 골목 안쪽.'));
});

test('particle — 끝이 괄호·영문이면 마지막 한글 기준', () => {
  const D = require('../lib/draft');
  assert.equal(D.particle('히레카츠 + 면요리세트(우동/소바)', '을를'), '를');
  assert.equal(D.particle('카레(비건)', '은는'), '는');
  assert.equal(D.particle('플래터(2인)', '이가'), '가');
});
