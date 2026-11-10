'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.PERSONA_DIR = path.join(require('node:os').tmpdir(), 'place-check-persona-store-test');
fs.rmSync(process.env.PERSONA_DIR, { recursive: true, force: true });
const ST = require('../lib/persona-store');

const T = Date.parse('2026-11-10T03:00:00Z');

test('결과 보관: 7일 이내만, 다시 저장해도 기준 시각 유지, 이상한 ID 거절', () => {
  const saved = ST.writeResult('123', { status: 'ok', cards: [] }, T);
  assert.equal(ST.readResult('123', T + ST.TTL_MS - 1).status, 'ok');
  assert.equal(ST.readResult('123', T + ST.TTL_MS), null);
  ST.writeResult('123', { ...saved, extras_status: 'ready' }, T + 5000);
  assert.equal(ST.readResult('123', T + 6000).saved_at, new Date(T).toISOString());
  assert.equal(ST.readResult('../x', T), null);
  assert.throws(() => ST.writeResult('../x', {}, T));
  assert.equal(ST.readResult('999', T), null);
});

test('코드 확인', () => {
  const env = { PERSONA_CODES: '1234, 5678' };
  assert.equal(ST.codeOk('1234', env), true); assert.equal(ST.codeOk(' 5678 ', env), true);
  assert.equal(ST.codeOk('12345', env), false); assert.equal(ST.codeOk('', env), false);
  assert.equal(ST.codeOk(undefined, env), false); assert.equal(ST.codeOk(1234, env), false);
  assert.equal(ST.codeOk('1234', {}), false); assert.equal(ST.codeOk('', { PERSONA_CODES: '' }), false); assert.equal(ST.codeOk(',', { PERSONA_CODES: ',' }), false);
});

test('하루 상한 예약: KST 날짜별, 상한에서 거절', () => {
  assert.equal(ST.reserve(T, 2), true); assert.equal(ST.reserve(T, 2), true); assert.equal(ST.reserve(T, 2), false);
  assert.equal(ST.dailyCount(T), 2);
  const nextDay = Date.parse('2026-11-10T15:00:00Z'); // KST 11-11 00:00
  assert.equal(ST.dailyCount(nextDay), 0); assert.equal(ST.reserve(nextDay, 2), true);
});

test('기록: 형식이 틀린 방문자 번호·채널은 버리고, 집계는 방문자 유일 수', () => {
  ST.logEvent({ type: 'analyze', placeId: '1', name: '가', category: '돈가스', vid: 'aaaaaaaa1111', ch: 'ig', cards: ['민준 씨'] }, T);
  ST.logEvent({ type: 'view', placeId: '1', vid: 'aaaaaaaa1111', ch: 'kakao' }, T);
  ST.logEvent({ type: 'analyze', placeId: '2', name: '나', vid: 'bbbbbbbb2222' }, T);
  ST.logEvent({ type: 'analyze', placeId: '3', vid: '<script>' }, T);
  ST.logEvent({ type: 'unlock', placeId: '1', vid: 'aaaaaaaa1111' }, T);
  ST.logEvent({ type: 'reject', placeId: '4', category: '미용실', reason: 'not_food' }, T);
  ST.logEvent({ type: 'hack', placeId: '5' }, T);
  const a = ST.aggregate(); const d = a.days['2026-11-10'];
  assert.deepEqual({ analyze: d.analyze, view: d.view, unlock: d.unlock, reject: d.reject, visitors: d.visitors, unlockers: d.unlockers }, { analyze: 3, view: 1, unlock: 1, reject: 1, visitors: 2, unlockers: 1 });
  assert.equal(a.rejects['미용실'], 1);
  assert.equal(a.recent.length, 3); assert.equal(a.recent[0].vid, null); assert.equal(a.recent[2].ch, 'ig');
  const raw = fs.readFileSync(path.join(process.env.PERSONA_DIR, 'events.jsonl'), 'utf8');
  assert.ok(!raw.includes('<script>')); assert.ok(!raw.includes('kakao'));
});

test('R2-02 예산 파일이 깨지면 초기화하지 않고 예약을 거절, 저장은 임시 파일→이름 바꾸기', () => {
  const daily = path.join(process.env.PERSONA_DIR, 'daily.json');
  const before = fs.readFileSync(daily, 'utf8');
  fs.writeFileSync(daily, '');
  assert.equal(ST.reserve(T, 100), false);
  fs.writeFileSync(daily, '{"2026-11-10": 2');
  assert.equal(ST.reserve(T, 100), false);
  assert.equal(fs.readFileSync(daily, 'utf8'), '{"2026-11-10": 2', '깨진 파일을 덮어쓰지 않음');
  fs.writeFileSync(daily, '[1,2]');
  assert.equal(ST.reserve(T, 100), false, '객체가 아니면 깨진 것으로 본다');
  fs.writeFileSync(daily, before);
  assert.equal(ST.reserve(Date.parse('2026-11-12T03:00:00Z'), 100), true);
  assert.ok(!fs.existsSync(daily + '.tmp'));
});

test('R3-05 상한 0은 0으로, 장부 값이 숫자가 아니면 깨진 것으로 본다', () => {
  const daily = path.join(process.env.PERSONA_DIR, 'daily.json');
  const before = fs.readFileSync(daily, 'utf8');
  const day = Date.parse('2026-11-20T03:00:00Z');
  assert.equal(ST.reserve(day, 0), false);
  const keep = process.env.PERSONA_DAILY_MAX;
  process.env.PERSONA_DAILY_MAX = '0'; assert.equal(ST.reserve(day), false);
  process.env.PERSONA_DAILY_MAX = '1'; assert.equal(ST.reserve(day), true); assert.equal(ST.reserve(day), false);
  process.env.PERSONA_DAILY_MAX = '엉뚱'; assert.equal(ST.dailyMax(), 300);
  process.env.PERSONA_DAILY_MAX = '-5'; assert.equal(ST.dailyMax(), 300);
  process.env.PERSONA_DAILY_MAX = ''; assert.equal(ST.dailyMax(), 300);
  if (keep === undefined) delete process.env.PERSONA_DAILY_MAX; else process.env.PERSONA_DAILY_MAX = keep;
  for (const bad of ['{"2026-11-20":"broken"}', '{"2026-11-20":-1}', '{"2026-11-20":1.5}', '{"2026-11-20":null}']) {
    fs.writeFileSync(daily, bad);
    assert.equal(ST.reserve(day, 5), false, bad);
    assert.equal(fs.readFileSync(daily, 'utf8'), bad);
  }
  fs.writeFileSync(daily, before);
});
