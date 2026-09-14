'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parsePlaceUrl } = require('../lib/url-parse');

const ok = (placeId, type) => ({ ok: true, placeId, type, needsResolve: false });
const UNSUPPORTED = { ok: false, reason: 'unsupported' };

test('m.place / pcmap: type + id, with tab/query/hash', () => {
  assert.deepStrictEqual(parsePlaceUrl('https://m.place.naver.com/restaurant/2086785604'), ok('2086785604', 'restaurant'));
  assert.deepStrictEqual(parsePlaceUrl('https://m.place.naver.com/restaurant/2086785604/home?entry=pll#tab'), ok('2086785604', 'restaurant'));
  assert.deepStrictEqual(parsePlaceUrl('https://pcmap.place.naver.com/cafe/123/review'), ok('123', 'cafe'));
  assert.deepStrictEqual(parsePlaceUrl('https://pcmap.place.naver.com/hospital/123/review'), ok('123', 'hospital'));
  assert.deepStrictEqual(parsePlaceUrl('http://m.place.naver.com/place/99'), ok('99', 'place'));
});

test('map.naver.com entry/search/v5 patterns → type null', () => {
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/entry/place/2086785604?c=15.00,0,0,0,dh'), ok('2086785604', null));
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/search/안국/place/123'), ok('123', null));
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/search/%EC%95%88%EA%B5%AD/place/123?c=1'), ok('123', null));
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/v5/entry/place/2086785604#x'), ok('2086785604', null));
});

test('naver.me short URL → needsResolve', () => {
  assert.deepStrictEqual(parsePlaceUrl('https://naver.me/AbCd1234'), { ok: true, shortUrl: 'https://naver.me/AbCd1234', needsResolve: true });
});

test('first https?:// URL extracted from free text, trailing punctuation trimmed', () => {
  assert.deepStrictEqual(parsePlaceUrl('우리 가게요 https://m.place.naver.com/restaurant/2086785604/home 확인 부탁'), ok('2086785604', 'restaurant'));
  assert.deepStrictEqual(parsePlaceUrl('링크: https://naver.me/AbCd1234.'), { ok: true, shortUrl: 'https://naver.me/AbCd1234', needsResolve: true });
});

test('placeId must be a full decimal segment', () => {
  assert.deepStrictEqual(parsePlaceUrl('https://m.place.naver.com/restaurant/123abc'), UNSUPPORTED);
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/entry/place/abc123'), UNSUPPORTED);
  assert.deepStrictEqual(parsePlaceUrl('https://m.place.naver.com/restaurant/'), UNSUPPORTED);
});

test('digits only in query / search URL without place → unsupported (no digit scanning)', () => {
  assert.deepStrictEqual(parsePlaceUrl('https://m.map.naver.com/search2/site.naver?code=2086785604'), UNSUPPORTED);
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/search/2086785604'), UNSUPPORTED);
  assert.deepStrictEqual(parsePlaceUrl('https://map.naver.com/p/search/%2Fplace%2F123?q=/place/456'), UNSUPPORTED);
  assert.deepStrictEqual(parsePlaceUrl('https://example.com/place/123'), UNSUPPORTED);
});

test('no URL → no_url (scheme-less input is treated as no URL — only https?:// is extracted)', () => {
  assert.deepStrictEqual(parsePlaceUrl(''), { ok: false, reason: 'no_url' });
  assert.deepStrictEqual(parsePlaceUrl('2086785604'), { ok: false, reason: 'no_url' });
  assert.deepStrictEqual(parsePlaceUrl('m.place.naver.com/restaurant/2086785604'), { ok: false, reason: 'no_url' });
  assert.deepStrictEqual(parsePlaceUrl(null), { ok: false, reason: 'no_url' });
});
