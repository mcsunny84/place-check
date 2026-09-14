'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/naver-searchad');

const ENV = { NAVER_AD_API_KEY: 'k', NAVER_AD_SECRET: 's', NAVER_AD_CUSTOMER_ID: '123' };

test('creds: 3종 다 있어야 함', () => {
  assert.equal(A.creds({}), null); assert.ok(A.creds(ENV));
});

test('sign/headers: HMAC-SHA256(secret, "ts.METHOD.uri") base64', () => {
  const h = A.headers({ key: 'k', secret: 's', customer: '123' }, 'GET', '/keywordstool', 1700000000000);
  assert.equal(h['X-Timestamp'], '1700000000000'); assert.equal(h['X-API-KEY'], 'k'); assert.equal(h['X-Customer'], '123');
  assert.equal(h['X-Signature'], A.sign('s', '1700000000000', 'GET', '/keywordstool'));
  assert.equal(A.sign('s', '1700000000000', 'GET', '/keywordstool'), require('node:crypto').createHmac('sha256', 's').update('1700000000000.GET./keywordstool').digest('base64'));
});

test('num: "< 10" → 9, 숫자 그대로, 이상값 null', () => {
  assert.equal(A.num('< 10'), 9); assert.equal(A.num(1234), 1234); assert.equal(A.num('120'), 120); assert.equal(A.num(null), null);
});

test('getKeywordVolumes: 5개씩 배치, 공백 무시 매칭, 미매칭 null, 키 없으면 null', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.ok(opts.headers['X-Signature']);
    const hints = decodeURIComponent(url.split('hintKeywords=')[1].split('&')[0]).split(',');
    return { status: 200, json: async () => ({ keywordList: hints.filter((h) => h !== '없는키워드').map((h) => ({ relKeyword: h, monthlyPcQcCnt: 100, monthlyMobileQcCnt: '< 10', compIdx: '중간' })).concat([{ relKeyword: '연관어', monthlyPcQcCnt: 5, monthlyMobileQcCnt: 5 }]) }) };
  };
  const r = await A.getKeywordVolumes(['안국역 돈카츠', '안국 맛집', 'a', 'b', 'c', '없는키워드'], { fetchImpl, env: ENV });
  assert.equal(calls.length, 2, '6개 → 2배치');
  assert.deepEqual(r['안국역 돈카츠'], { pc: 100, mobile: 9, total: 109, comp: '중간' });
  assert.deepEqual(r['없는키워드'], { pc: null, mobile: null, total: null, comp: null });
  assert.equal(await A.getKeywordVolumes(['x'], { fetchImpl, env: {} }), null);
});

test('getKeywordVolumes: 401 → throw', async () => {
  await assert.rejects(A.getKeywordVolumes(['x'], { fetchImpl: async () => ({ status: 401, text: async () => 'bad' }), env: ENV }), /searchad 401/);
});
