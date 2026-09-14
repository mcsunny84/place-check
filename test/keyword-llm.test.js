'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../lib/keyword');
const KL = require('../lib/keyword-llm');

test('shortDistrict: 시·구·동 접미 제거, 2글자는 유지', () => {
  assert.equal(K.shortDistrict('경주시'), '경주'); assert.equal(K.shortDistrict('종로구'), '종로'); assert.equal(K.shortDistrict('안국동'), '안국');
  assert.equal(K.shortDistrict('중구'), '중구'); assert.equal(K.shortDistrict('양평읍'), '양평'); assert.equal(K.shortDistrict(''), '');
});

test('recommendKeywords: 뭉뚱그린 업종(양식)은 리뷰 메뉴 용어로 대체, 지역은 짧은 형태', () => {
  const out = K.recommendKeywords({ district: '경주시', station: null, categoryNorm: '양식', suffix: '맛집', menus: ['브리스킷 듀오 플래터'], reviewMenus: ['바베큐', '고기'], situations: ['회식'], existing: [] });
  const kws = out.map((o) => o.keyword);
  assert.ok(kws.includes('경주 바베큐'), kws.join('|')); assert.ok(kws.includes('경주 맛집'));
  assert.ok(!kws.some((k) => k.startsWith('경주시')), '경주시 접미 제거');
});

test('diagnoseKeywords: 지역 토큰이 짧은 형태(경주)도 인식, 리뷰 메뉴(바베큐)도 업종으로 인식', () => {
  const d = K.diagnoseKeywords(['경주식당', '텍사스바베큐'], { name: '택산가든', district: '경주시', station: null, category: '양식', menus: [], reviewMenus: ['바베큐'] });
  assert.ok(!d[0].labels.includes('지역 없음'), JSON.stringify(d[0]));
  assert.ok(!d[1].labels.includes('업종·메뉴 없음'), JSON.stringify(d[1]));
});

test('recommendKeywordsLLM: 주입 성공/실패/없음', async () => {
  const facts = { name: { status: 'value', value: '택산가든' }, category: { status: 'value', value: '양식' }, roadAddress: { status: 'value', value: '경북 경주시 보문로 182-27' }, menus: { status: 'value', value: [{ name: '브리스킷' }] }, reviewStats: { status: 'value', value: { menus: [{ name: '바베큐', count: 118 }] } }, reviews: { status: 'value', value: [{ visitCategories: ['여행', '가족모임'] }] } };
  const ok = await KL.recommendKeywordsLLM(facts, { station: null, existing: ['경주식당'], blogTitles: ['경주 보문단지 맛집 택산가든'] }, { llm: async (p) => { assert.ok(p.includes('보문단지') && p.includes('바베큐 118')); return { keywords: [{ keyword: '경주 바베큐', why: '리뷰' }], diagnosis: [{ keyword: '경주식당', verdict: 'keep', why: 'ok' }] }; } });
  assert.equal(ok.keywords[0].keyword, '경주 바베큐'); assert.equal(ok.diagnosis[0].verdict, 'keep');
  assert.equal(await KL.recommendKeywordsLLM(facts, {}, { llm: async () => { throw new Error('x'); } }), null);
  assert.equal(await KL.recommendKeywordsLLM(facts, {}, { llm: null }), null);
});
