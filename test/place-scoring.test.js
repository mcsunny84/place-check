'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/place-scoring');
const { ITEMS, judge, computeScore, pickTodos, pickSupplement, scanDanger } = S;

const AS = '2026-09-14';
const ctx = { asOf: AS, answers: {} };
const ALL_PASS = {
  A1: 'yes', A2: 'all', A3: 'yes', A4: 'yes', B1: 300, B2: 5, B3: 'price', B4: 'yes', B5: 25, B6: AS, B7: 'yes',
  C1: 'on', C2: 'yes', C3: 'yes', C4: 'yes', D1: AS, D2: AS, D3: 'clean'
};
const without = (o, ids) => { const c = { ...o }; ids.forEach(i => delete c[i]); return c; };
const only = ids => Object.fromEntries(ids.map(i => [i, ALL_PASS[i]]));
const W = Object.fromEntries(ITEMS.map(i => [i.id, i.weight]));

test('ITEMS: 18개, 배점 합 100, 그룹 20/40/15/25, 순서 고정', () => {
  assert.equal(ITEMS.length, 18);
  assert.equal(ITEMS.reduce((s, i) => s + i.weight, 0), 100);
  const g = {}; ITEMS.forEach(i => { g[i.group] = (g[i.group] || 0) + i.weight; });
  assert.deepEqual(g, { A: 20, B: 40, C: 15, D: 25 });
  assert.deepEqual(ITEMS.map(i => i.id), ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3']);
  ITEMS.forEach(i => assert.ok(i.label && typeof i.label === 'string'));
});

test('UMD: 브라우저 전역 정의', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/place-scoring'), 'utf8');
  const win = {};
  new Function('window', 'self', src)(win, win);
  assert.equal(win.PlaceScoring.ITEMS.length, 18);
});

test('judge: 미정의·형식 오류·미지 id → unknown', () => {
  assert.equal(judge('A1', undefined, ctx), 'unknown');
  assert.equal(judge('A1', 'maybe', ctx), 'unknown');
  assert.equal(judge('Z9', 'yes', ctx), 'unknown');
  assert.equal(judge('B3', 'PRICE', ctx), 'unknown');
});

test('judge: 예/아니오·선택형 전이', () => {
  for (const id of ['A1', 'A4', 'B4', 'B7', 'C2', 'C3', 'C4']) {
    assert.equal(judge(id, 'yes', ctx), 'pass', id);
    assert.equal(judge(id, 'no', ctx), 'fail', id);
  }
  assert.equal(judge('A2', 'all', ctx), 'pass');
  assert.equal(judge('A2', 'some', ctx), 'partial');
  assert.equal(judge('A2', 'no', ctx), 'fail');
  assert.equal(judge('A3', 'na', ctx), 'na');
  assert.equal(judge('A3', 'no', ctx), 'fail');
  assert.equal(judge('B3', 'price', ctx), 'pass');
  assert.equal(judge('B3', 'menu_only', ctx), 'partial');
  assert.equal(judge('B3', 'none', ctx), 'fail');
  assert.equal(judge('C1', 'on', ctx), 'pass');
  assert.equal(judge('C1', 'off', ctx), 'fail');
  assert.equal(judge('C1', 'na', ctx), 'na');
});

test('judge: 정수 검증 (trim, /^\\d+$/, ≤9999)', () => {
  assert.equal(judge('B5', ' 25 ', ctx), 'pass');
  assert.equal(judge('B5', 25, ctx), 'pass');
  assert.equal(judge('B5', '9999', ctx), 'pass');
  assert.equal(judge('B5', '10000', ctx), 'unknown');
  assert.equal(judge('B5', '25.0', ctx), 'unknown');
  assert.equal(judge('B5', '-1', ctx), 'unknown');
  assert.equal(judge('B5', 'abc', ctx), 'unknown');
  assert.equal(judge('B5', '', ctx), 'unknown');
  assert.equal(judge('B5', 2.5, ctx), 'unknown');
  // 경계
  assert.equal(judge('B5', 20, ctx), 'pass');
  assert.equal(judge('B5', 19, ctx), 'partial');
  assert.equal(judge('B5', 5, ctx), 'partial');
  assert.equal(judge('B5', 4, ctx), 'fail');
  assert.equal(judge('B5', 3, ctx), 'fail');
  assert.equal(judge('B5', 0, ctx), 'fail');
  assert.equal(judge('B1', 200, ctx), 'pass');
  assert.equal(judge('B1', 199, ctx), 'partial');
  assert.equal(judge('B1', 1, ctx), 'partial');
  assert.equal(judge('B1', 0, ctx), 'fail');
  assert.equal(judge('B2', 5, ctx), 'pass');
  assert.equal(judge('B2', 4, ctx), 'partial');
  assert.equal(judge('B2', 1, ctx), 'partial');
  assert.equal(judge('B2', 0, ctx), 'fail');
  assert.equal(judge('B2', 6, ctx), 'unknown');
  assert.equal(judge('B2', '3', ctx), 'partial');
});

test('judge: 날짜 경계 30/31, 90/91, 180/181, 미래, 형식 오류', () => {
  // 05번 §1.2: 08-15/08-14 = 30/31, 06-16/06-15 = 90/91, 03-18/03-17 = 180/181
  assert.equal(judge('B6', '2026-08-15', ctx), 'pass');
  assert.equal(judge('B6', '2026-08-14', ctx), 'partial');
  assert.equal(judge('B6', '2026-06-16', ctx), 'partial');
  assert.equal(judge('B6', '2026-06-15', ctx), 'fail');
  assert.equal(judge('B6', 'none', ctx), 'fail');
  assert.equal(judge('D2', '2026-08-15', ctx), 'pass');
  assert.equal(judge('D2', '2026-08-14', ctx), 'partial');
  assert.equal(judge('D2', '2026-06-16', ctx), 'partial');
  assert.equal(judge('D2', '2026-06-15', ctx), 'fail');
  assert.equal(judge('D2', 'none', ctx), 'fail');
  assert.equal(judge('D1', '2026-06-16', ctx), 'pass');
  assert.equal(judge('D1', '2026-06-15', ctx), 'partial');
  assert.equal(judge('D1', '2026-03-18', ctx), 'partial');
  assert.equal(judge('D1', '2026-03-17', ctx), 'fail');
  assert.equal(judge('D1', 'none', ctx), 'fail');
  assert.equal(judge('D1', AS, ctx), 'pass');
  // 미래·형식 오류
  assert.equal(judge('D1', '2026-09-15', ctx), 'unknown');
  assert.equal(judge('D1', '2026-9-1', ctx), 'unknown');
  assert.equal(judge('D1', '2026-02-30', ctx), 'unknown');
  assert.equal(judge('D1', '2026/09/01', ctx), 'unknown');
  assert.equal(judge('D1', '', ctx), 'unknown');
  assert.equal(judge('D1', '2026-09-01', { asOf: 'bad', answers: {} }), 'unknown');
  // 연말·윤년 경계는 달력일로
  assert.equal(S.daysAgo('2025-12-31', '2026-01-30'), 30);
  assert.equal(S.daysAgo('2024-02-28', '2024-03-01'), 2);
});

test('judge: D2 선행 조건 — D1 none → na', () => {
  assert.equal(judge('D2', undefined, { asOf: AS, answers: { D1: 'none' } }), 'na');
  assert.equal(judge('D2', AS, { asOf: AS, answers: { D1: 'none' } }), 'na');
  assert.equal(judge('D2', undefined, { asOf: AS, answers: { D1: AS } }), 'unknown');
  assert.equal(judge('D2', undefined, { asOf: AS, answers: {} }), 'unknown');
});

test('judge: D3 사전 검사 + passthrough', () => {
  assert.equal(judge('D3', 'clean', ctx), 'pass');
  assert.equal(judge('D3', 'flagged', ctx), 'fail');
  assert.equal(judge('D3', { text: '' }, ctx), 'unknown');
  assert.equal(judge('D3', { text: '   \n ' }, ctx), 'unknown');
  assert.equal(judge('D3', {}, ctx), 'unknown');
  assert.equal(judge('D3', 'hello', ctx), 'unknown');
  assert.equal(judge('D3', { text: '300시간 숙성 돈카츠, 안국역 3번 출구 도보 2분.' }, ctx), 'pass');
  assert.equal(judge('D3', { text: '리뷰 쓰면 음료 무료!' }, ctx), 'fail');
});

test('scanDanger: 강요·점수 지정·허위 유도·효능 단정·보장 검출, 정상 문구 미검출', () => {
  const hits = t => scanDanger(t).map(h => h.label);
  assert.ok(hits('별점 5개 부탁드려요').includes('별점 요청'));
  assert.ok(hits('별 다섯 개 주세요').includes('별점 요청'));
  assert.ok(hits('평점 5점 남겨주시면').includes('점수 지정'));
  assert.ok(hits('리뷰 작성 시 아메리카노 서비스').includes('리뷰 대가 제공'));
  assert.ok(hits('후기 남기면 10% 할인').includes('리뷰 대가 제공'));
  assert.ok(hits('리뷰는 필수입니다').includes('리뷰 강요'));
  assert.ok(hits('방문 안 해도 리뷰 가능').includes('허위 리뷰 유도'));
  assert.ok(hits('100% 완치 보장').includes('효능 단정'));
  assert.ok(hits('무조건 살 빠짐').includes('효능 단정'));
  assert.ok(hits('지역 1위 보장').includes('보장 표현'));
  assert.deepEqual(hits('방문자 리뷰 감사합니다. 정성껏 답글 드릴게요. 주차는 건물 지하 이용 가능.'), []);
  assert.deepEqual(hits(''), []);
  assert.deepEqual(hits(null), []);
  const h = scanDanger('안녕하세요 리뷰 쓰면 무료 음료');
  assert.equal(typeof h[0].index, 'number');
  assert.ok(h[0].match.length > 0);
  assert.ok(S.DANGER.length >= 10 && S.DANGER.every(d => d.pattern instanceof RegExp && d.label));
});

test('computeScore: 82 pass + D1/D2 unknown → P100 K82 score100 coverage .82', () => {
  const r = computeScore(without(ALL_PASS, ['D1', 'D2']), { asOf: AS });
  assert.equal(r.version, 'place-check-1.0');
  assert.equal(r.score, 100);
  assert.equal(r.coverage, 0.82);
  assert.equal(r.display, 'score');
  assert.equal(r.grade, 'A');
  assert.equal(r.items.length, 18);
  assert.deepEqual(r.groups.D, { earned: 7, applicable: 25, known: 7 });
  assert.deepEqual(r.groups.A, { earned: 20, applicable: 20, known: 20 });
});

test('computeScore: D1 none → D1 fail, D2 na → P90 K90 E82 score 91 coverage 1', () => {
  const r = computeScore({ ...without(ALL_PASS, ['D2']), D1: 'none' }, { asOf: AS });
  assert.equal(r.score, 91);
  assert.equal(r.coverage, 1);
  assert.equal(r.display, 'score');
  assert.equal(r.grade, 'A');
  assert.equal(r.items.find(i => i.id === 'D2').state, 'na');
  assert.deepEqual(r.groups.D, { earned: 7, applicable: 15, known: 15 });
  // D2 값이 있어도 na 유지
  assert.equal(computeScore({ ...ALL_PASS, D1: 'none' }, { asOf: AS }).items.find(i => i.id === 'D2').state, 'na');
});

test('computeScore: K=70 E=35 → 50 D, display score', () => {
  const a = { ...only(['A1', 'A2', 'A4', 'B1', 'B3', 'C2']),
    A3: 'no', B5: 0, B6: 'none', B7: 'no', C1: 'off', C3: 'no', C4: 'no', D3: 'flagged' };
  const r = computeScore(a, { asOf: AS });
  assert.equal(r.coverage, 0.7);
  assert.equal(r.score, 50);
  assert.equal(r.grade, 'D');
  assert.equal(r.display, 'score');
});

test('computeScore: 전부 unknown → insufficient, score null, grade null', () => {
  const r = computeScore({}, { asOf: AS });
  assert.equal(r.score, null);
  assert.equal(r.grade, null);
  assert.equal(r.coverage, 0);
  assert.equal(r.display, 'insufficient');
  assert.ok(r.items.every(i => i.state === 'unknown'));
  assert.deepEqual(computeScore(undefined, { asOf: AS }).display, 'insufficient');
});

test('computeScore: coverage 경계 49/50/69/70', () => {
  const r49 = computeScore(only(['D2', 'D1', 'B2', 'B1', 'B3', 'D3', 'B7']), { asOf: AS });
  assert.equal(r49.coverage, 0.49);
  assert.equal(r49.display, 'insufficient');
  assert.equal(r49.score, 100); // 내부 점수는 계산되나 표시 안 함
  assert.equal(r49.grade, null);
  const r50 = computeScore(only(['D2', 'D1', 'B2', 'B1', 'B3', 'A2', 'B4']), { asOf: AS });
  assert.equal(r50.coverage, 0.5);
  assert.equal(r50.display, 'grade');
  assert.equal(r50.grade, 'A');
  const r69 = computeScore(only(['D2', 'D1', 'B2', 'B1', 'B3', 'A2', 'B4', 'A1', 'A4', 'B6', 'B7']), { asOf: AS });
  assert.equal(r69.coverage, 0.69);
  assert.equal(r69.display, 'grade');
  const r70 = computeScore(without(ALL_PASS, ['D2', 'D1', 'B2', 'B4']), { asOf: AS });
  assert.equal(r70.coverage, 0.7);
  assert.equal(r70.display, 'score');
  assert.equal(r70.score, 100);
});

test('computeScore: n/a 3항목 제외 → P82 K82 coverage 1 score 100', () => {
  const r = computeScore({ ...ALL_PASS, A3: 'na', C1: 'na', D1: 'none' }, { asOf: AS });
  // D1 none은 fail(8) — P=90 K=90 E=82 → 91. 순수 n/a 3항목만 제외 사례는 D1 pass로:
  const r2 = computeScore({ ...ALL_PASS, A3: 'na', C1: 'na', D2: undefined }, { asOf: AS });
  assert.equal(r.items.find(i => i.id === 'D2').state, 'na');
  assert.equal(r2.items.find(i => i.id === 'D2').state, 'unknown');
  assert.equal(r2.groups.A.applicable + r2.groups.B.applicable + r2.groups.C.applicable + r2.groups.D.applicable, 92);
  const r3 = computeScore({ ...ALL_PASS, A3: 'na', C1: 'na', D1: 'none' }, { asOf: AS });
  assert.equal(r3.groups.A.applicable + r3.groups.B.applicable + r3.groups.C.applicable + r3.groups.D.applicable, 82);
  assert.equal(r3.coverage, 1);
});

test('computeScore: E=89.5 → 반올림 90 A', () => {
  const r = computeScore({ ...ALL_PASS, B1: 0, B3: 'menu_only' }, { asOf: AS });
  assert.equal(r.score, 90);
  assert.equal(r.grade, 'A');
  assert.equal(r.coverage, 1);
});

test('computeScore: 등급 경계 89/75/74/60/59', () => {
  const grade = fails => computeScore({ ...ALL_PASS, ...fails }, { asOf: AS });
  let r = grade({ B2: 0, B5: 4 }); assert.equal(r.score, 86); assert.equal(r.grade, 'B');           // 100-8-6
  r = grade({ D2: 'none', B2: 0, B1: 0 }); assert.equal(r.score, 75); assert.equal(r.grade, 'B');      // 100-10-8-7
  r = grade({ D2: 'none', B2: 0, B1: 0, B7: 'no' }); assert.equal(r.score, 73); assert.equal(r.grade, 'C');
  r = grade({ D2: 'none', B2: 0, B1: 0, B3: 'none', B5: 0, B7: 'no' }); assert.equal(r.score, 60); assert.equal(r.grade, 'C');
  r = grade({ D2: 'none', B2: 0, B1: 0, B3: 'none', B5: 0, B7: 'no', A3: 'no' }); assert.equal(r.score, 57); assert.equal(r.grade, 'D');
});

test('computeScore: 미지 id 무시', () => {
  const r = computeScore({ ...ALL_PASS, Z9: 'yes' }, { asOf: AS });
  assert.equal(r.items.length, 18);
  assert.equal(r.score, 100);
});

test('pickTodos: D3 fail 1순위, weight×(fail1/partial.5) desc, ID asc 동률, 최대 3', () => {
  const r = computeScore({ ...ALL_PASS, D2: 'none', B2: 0, B3: 'none', D3: 'flagged' }, { asOf: AS });
  assert.deepEqual(pickTodos(r), ['D3', 'D2', 'B2']);
  const r2 = computeScore({ ...ALL_PASS, B2: 0, B3: 'none', D3: 'flagged' }, { asOf: AS });
  assert.deepEqual(pickTodos(r2), ['D3', 'B2', 'B3']);
  // B2(8) fail vs B3(7) fail → B2 먼저; B1(7) fail vs B3(7) fail → ID asc
  const r3 = computeScore({ ...ALL_PASS, B3: 'none', B1: 0 }, { asOf: AS });
  assert.deepEqual(pickTodos(r3), ['B1', 'B3']);
  // partial 가중: D2 partial(5) < A2 fail(6)
  const r4 = computeScore({ ...ALL_PASS, D2: '2026-08-14', A2: 'no' }, { asOf: AS });
  assert.deepEqual(pickTodos(r4), ['A2', 'D2']);
  // unknown·na·pass 제외
  const r5 = computeScore({ ...without(ALL_PASS, ['B5']), A3: 'na' }, { asOf: AS });
  assert.deepEqual(pickTodos(r5), []);
  assert.deepEqual(pickTodos(computeScore(ALL_PASS, { asOf: AS })), []);
  // D3 partial은 없으니 D3 pass면 고정 슬롯 없음
  assert.deepEqual(pickTodos(computeScore({ ...ALL_PASS, A1: 'no' }, { asOf: AS })), ['A1']);
});

test('pickSupplement: 고정 순서, 최대 5, D1 none이면 D2 제외', () => {
  const r = computeScore({}, { asOf: AS });
  assert.deepEqual(pickSupplement(r), ['D1', 'D2', 'B2', 'B5', 'B6']);
  const r2 = computeScore({ D1: 'none' }, { asOf: AS });
  assert.deepEqual(pickSupplement(r2), ['B2', 'B5', 'B6', 'C1', 'A3']);
  const r3 = computeScore(without(ALL_PASS, ['B4', 'C4', 'A1']), { asOf: AS }); // A1은 목록 밖
  assert.deepEqual(pickSupplement(r3), ['C4', 'B4']);
  assert.deepEqual(pickSupplement(computeScore(ALL_PASS, { asOf: AS })), []);
});
