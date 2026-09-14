const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { COPY } = require('../lib/copy.js');

const IDS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3'];

test('UMD: require and browser global', () => {
  const g = {};
  new Function(fs.readFileSync(path.join(__dirname, '../lib/copy.js'), 'utf8')).call(g);
  assert.deepEqual(Object.keys(g.PlaceCopy.COPY), IDS);
});

test('COPY — 18개 전부 why/how 비어 있지 않음, 경로 포함', () => {
  assert.deepEqual(Object.keys(COPY), IDS);
  for (const id of IDS) {
    const c = COPY[id];
    assert.ok(c.why.trim().length > 10, id + ' why');
    assert.ok(c.how.startsWith('스마트플레이스 >'), id + ' how path');
    assert.ok(c.how.trim().length > 30, id + ' how');
    if ('tip' in c) assert.ok(c.tip.trim().length > 0, id + ' tip');
  }
});

test('COPY — 순위·매출 약속 없음', () => {
  for (const id of IDS) {
    const all = [COPY[id].why, COPY[id].how, COPY[id].tip || ''].join(' ');
    assert.ok(!/순위\s*(상승|보장)|매출\s*(상승|증가|보장)|상위\s*노출/.test(all), id);
  }
});
