'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../lib/place-parse');
const A = require('../lib/draft-analysis');

const FX = path.join(__dirname, 'fixtures');
const V = (x) => ({ status: 'value', value: x });

test('analyzeDescription: 안국역점 실제 설명 — 주차·역 언급 있음, Q&A 없음, 지역명 있음', () => {
  const f = P.parseHome(fs.readFileSync(path.join(FX, 'kise-anguk-home.html'), 'utf8'));
  const a = A.analyzeDescription(f.description.value, f, { district: '종로구', station: '안국역', categoryNorm: '돈카츠', existing: f.keywords.value, booking: 'naver' });
  assert.ok(a.length > 100); assert.equal(a.hasText, true);
  const t = Object.fromEntries(a.topics.map((x) => [x.key, x.covered]));
  assert.equal(t.parking, true); assert.equal(t.qa, false); assert.equal(a.regionHit, true); assert.equal(a.catHit, true);
  assert.ok(a.edits.some((e) => e.what.includes('Q.')), 'Q&A 형식 제안');
  assert.ok(!a.add.some((x) => x.q === '주차 되나요?'), '이미 있는 주제는 추가 제안 안 함');
});

test('analyzeDescription: 빈 설명 → 전 주제 미커버, facts 기반 추가 Q&A 제안', () => {
  const facts = { conveniences: V(['주차', '포장', '단체 이용 가능']), parkingInfo: V('건물 지하 주차 1시간 무료'), road: V('2번 출구 도보 1분'), businessHours: V([{ day: '월', start: '11:00', end: '21:00', breaks: [] }, { day: '화', start: '11:00', end: '21:00', breaks: [] }]), menus: V([{ name: '로스카츠', price: V('12000') }]) };
  const a = A.analyzeDescription('', facts, { district: '안국', station: '안국역', categoryNorm: '돈카츠', existing: [], booking: 'naver' });
  assert.equal(a.hasText, false); assert.equal(a.length, 0);
  const qs = a.add.map((x) => x.q);
  assert.ok(qs.includes('주차 되나요?') && qs.includes('예약 가능한가요?') && qs.includes('포장이나 배달 되나요?') && qs.includes('단체도 되나요?') && qs.includes('영업시간은요?'));
  assert.ok(a.add.find((x) => x.q === '주차 되나요?').a.includes('지하 주차'));
  assert.ok(a.add.find((x) => x.q === '영업시간은요?').a.includes('월~화 11:00~21:00'));
  assert.ok(a.edits.some((e) => e.what.includes('비어')));
});

test('analyzeDescription: 주의 표현·지역명 누락·키워드 미포함 지적', () => {
  const a = A.analyzeDescription('맛있는 집입니다. 리뷰 쓰면 음료 무료!', { conveniences: V([]) }, { district: '안국', station: '안국역', categoryNorm: '돈카츠', existing: ['안국역 돈카츠', '안국 맛집'] });
  assert.ok(a.danger.length >= 1); assert.ok(a.edits.some((e) => e.why.includes('정책')));
  assert.equal(a.regionHit, false); assert.ok(a.edits.some((e) => e.what.includes('안국역 인근')));
  assert.equal(a.keywordsInText.length, 0);
});

test('reviseDescriptionLLM: 주입 성공/실패/없음', async () => {
  const facts = { name: V('키세카츠'), category: V('돈가스'), conveniences: V(['주차']), road: V('4번 출구') };
  const an = A.analyzeDescription('안녕하세요 키세카츠입니다.', facts, { district: '종로구', station: '안국역', categoryNorm: '돈카츠', existing: [] });
  const ok = await A.reviseDescriptionLLM('안녕하세요 키세카츠입니다.', facts, { district: '종로구', station: '안국역' }, an, { llm: async (p) => { assert.ok(p.includes('[현재 상세설명 — 원문]') && p.includes('4번 출구')); return { assessment: '짧아요.', keep: ['안녕하세요 키세카츠입니다.'], changes: [{ current: '안녕하세요 키세카츠입니다.', proposed: '안국역 인근 돈카츠 전문점 키세카츠입니다.', why: '지역·업종' }], add: [{ q: '주차 되나요?', a: '가능', why: '누락' }] }; } });
  assert.equal(ok.changes[0].proposed.includes('안국역'), true); assert.equal(ok.add.length, 1);
  assert.equal(await A.reviseDescriptionLLM('x', facts, {}, an, { llm: async () => { throw new Error('x'); } }), null);
  assert.equal(await A.reviseDescriptionLLM('x', facts, {}, an, { llm: null }), null);
});
