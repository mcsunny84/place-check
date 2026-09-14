'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { factsToAnswers } = require('../lib/facts-to-answers');
const { computeScore } = require('../lib/place-scoring');

const AS = '2026-09-14';
const V = v => ({ status: 'value', value: v });
const E = { status: 'empty' };
const M = { status: 'missing' };
const day = d => ({ day: d, start: '11:00', end: '21:00', breaks: [] });
const WEEK = ['월', '화', '수', '목', '금', '토', '일'].map(day);
const menu = (name, price, images) => ({ name, price, images, recommend: false, order: 0 });

// 자동 판정 전부 확정되는 "좋은" 매장
const GOOD = {
  phone: V('02-000-0000'), virtualPhone: V('0507-000-0000'), talktalkUrl: V('https://talk.naver.com/x'),
  naverBookingUsing: V(true), smartCallUsing: V(true), naverBookingUrl: V('https://booking.naver.com/x'),
  businessHours: V(WEEK.map((h, i) => i === 0 ? { ...h, breaks: [{ start: '15:00', end: '17:00' }] } : h)),
  hideBusinessHours: V(false),
  description: V('가'.repeat(250)), keywords: V(['안국역 돈카츠', '안국 맛집', '종로 돈카츠', '안국역 점심', '북촌 맛집']),
  accessor: V('안국역 3번 출구 도보 2분'), homepages: V(['https://instagram.com/x']),
  menus: V([menu('로스카츠', V('19900'), V(2)), menu('히레카츠', V('21900'), V(0))]), menuImages: V(1),
  conveniences: V(['주차', '포장']), parkingInfo: V('건물 지하 주차 가능'),
  visitorReviewsTotal: V(120), hasCouponCount: V(1),
  feeds: V([{ createdAt: '2026-09-01', category: '알림', period: null, isPinned: false, title: '추석', desc: '추석 연휴 정상 영업' }]),
  feedsComplete: V(true), totalImages: V(23)
};
const run = (facts, asOf = AS) => factsToAnswers(facts, { asOf });
const st = (facts, id, asOf) => run(facts, asOf).auto[id].state;
const raw = (facts, id, asOf) => run(facts, asOf).answers[id];

test('좋은 매장: D1·D2만 unknown, 나머지 확정', () => {
  const { answers, auto } = run(GOOD);
  assert.deepEqual(Object.keys(auto).sort(), ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3']);
  const unknown = Object.keys(auto).filter(id => auto[id].state === 'unknown');
  assert.deepEqual(unknown, ['D1', 'D2']);
  assert.ok(!('D1' in answers) && !('D2' in answers), 'unknown은 answers에 없음');
  Object.keys(auto).forEach(id => assert.ok(auto[id].source, id + ' source'));
  assert.deepEqual(answers, {
    A1: 'yes', A2: 'all', A3: 'yes', A4: 'yes', B1: 250, B2: 5, B3: 'price', B4: 'yes', B5: 23, B6: '2026-09-01', B7: 'yes',
    C1: 'on', C2: 'yes', C3: 'yes', C4: 'yes', D3: { text: '가'.repeat(250) + '\n추석 연휴 정상 영업' }
  });
  const r = computeScore(answers, { asOf: AS });
  assert.equal(r.score, 100);
  assert.equal(r.coverage, 0.82);
});

test('빈 facts → 전부 unknown', () => {
  const { answers, auto } = run({});
  assert.deepEqual(answers, {});
  assert.ok(Object.values(auto).every(a => a.state === 'unknown'));
  assert.equal(Object.keys(auto).length, 18);
});

test('A1: 하나 value → yes / 둘 다 empty → no / missing 섞임 → unknown', () => {
  assert.equal(raw({ phone: E, virtualPhone: V('0507-1') }, 'A1'), 'yes');
  assert.equal(raw({ phone: E, virtualPhone: E }, 'A1'), 'no');
  assert.equal(st({ phone: E, virtualPhone: E }, 'A1'), 'fail');
  assert.equal(st({ phone: E, virtualPhone: M }, 'A1'), 'unknown');
});

test('A2: hide=true + 7일 value → unknown(선행) / hide missing → unknown / 7·일부·empty', () => {
  assert.equal(st({ hideBusinessHours: V(true), businessHours: V(WEEK) }, 'A2'), 'unknown');
  assert.equal(st({ hideBusinessHours: M, businessHours: V(WEEK) }, 'A2'), 'unknown');
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: V(WEEK) }, 'A2'), 'all');
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: V(WEEK.slice(0, 5)) }, 'A2'), 'some');
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: V(WEEK.concat(WEEK)) }, 'A2'), 'all'); // 중복 요일
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: E }, 'A2'), 'no');
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: V([]) }, 'A2'), 'no');
  assert.equal(st({ hideBusinessHours: V(false), businessHours: M }, 'A2'), 'unknown');
});

test('A3: breaks 있음 → yes / 자동 empty → unknown (fail 없음)', () => {
  assert.equal(raw({ hideBusinessHours: V(false), businessHours: V([{ ...day('월'), breaks: [{ start: '15:00', end: '17:00' }] }]) }, 'A3'), 'yes');
  assert.equal(st({ hideBusinessHours: V(false), businessHours: V(WEEK) }, 'A3'), 'unknown');
  assert.equal(st({ businessHours: E }, 'A3'), 'unknown');
  assert.equal(st({ businessHours: V(WEEK) }, 'A3'), 'unknown');
  assert.ok(!('A3' in run({ businessHours: V(WEEK) }).answers));
});

test('A4: accessor value → yes / empty·공백 → unknown', () => {
  assert.equal(raw({ accessor: V('3번 출구') }, 'A4'), 'yes');
  assert.equal(st({ accessor: E }, 'A4'), 'unknown');
  assert.equal(st({ accessor: V('   ') }, 'A4'), 'unknown');
});

test('B1: 글자 수 NFC·trim·코드포인트 / empty → 0 fail / missing → unknown', () => {
  assert.equal(raw({ description: V('  한글 200자 미만  ') }, 'B1'), 10);
  assert.equal(raw({ description: V('한'.normalize('NFD')) }, 'B1'), 1);
  assert.equal(raw({ description: V('😀😀') }, 'B1'), 2);
  assert.equal(st({ description: V('가'.repeat(200)) }, 'B1'), 'pass');
  assert.equal(st({ description: V('가'.repeat(199)) }, 'B1'), 'partial');
  assert.equal(raw({ description: E }, 'B1'), 0);
  assert.equal(st({ description: E }, 'B1'), 'fail');
  assert.equal(st({ description: V('   ') }, 'B1'), 'fail');
  assert.equal(st({ description: M }, 'B1'), 'unknown');
});

test('B2: 문자열 배열 0~5 → count / >5·타입 오류 → unknown', () => {
  assert.equal(raw({ keywords: V(['a', 'b', 'c']) }, 'B2'), 3);
  assert.equal(st({ keywords: V(['a', 'b', 'c']) }, 'B2'), 'partial');
  assert.equal(st({ keywords: V([]) }, 'B2'), 'fail');
  assert.equal(st({ keywords: E }, 'B2'), 'fail');
  assert.equal(st({ keywords: V(['1', '2', '3', '4', '5', '6']) }, 'B2'), 'unknown');
  assert.equal(st({ keywords: V(['a', 1]) }, 'B2'), 'unknown');
  assert.equal(st({ keywords: V('a') }, 'B2'), 'unknown');
  assert.equal(st({ keywords: M }, 'B2'), 'unknown');
});

test('B3: price value ≥1 → price / 전부 empty → menu_only / Menu empty → none / empty+missing → unknown', () => {
  assert.equal(raw({ menus: V([menu('a', E, E), menu('b', V('9000'), E)]) }, 'B3'), 'price');
  assert.equal(raw({ menus: V([menu('a', E, E), menu('b', E, E)]) }, 'B3'), 'menu_only');
  assert.equal(raw({ menus: E }, 'B3'), 'none');
  assert.equal(raw({ menus: V([]) }, 'B3'), 'none');
  assert.equal(st({ menus: V([menu('a', E, E), menu('b', M, E)]) }, 'B3'), 'unknown');
  assert.equal(st({ menus: V([menu('a', M, E)]) }, 'B3'), 'unknown');
  assert.equal(st({ menus: M }, 'B3'), 'unknown');
  assert.equal(raw({ menus: V([menu('a', M, E), menu('b', V('1000'), E)]) }, 'B3'), 'price'); // 긍정 증거 우선
});

test('B4: 메뉴 images>0 또는 menuImages≥1 → yes / 둘 다 empty 확인 → no / 그 외 unknown', () => {
  assert.equal(raw({ menus: V([menu('a', E, V(1))]), menuImages: E }, 'B4'), 'yes');
  assert.equal(raw({ menus: V([menu('a', E, V(0))]), menuImages: V(2) }, 'B4'), 'yes');
  assert.equal(raw({ menus: M, menuImages: V(1) }, 'B4'), 'yes');
  assert.equal(raw({ menus: V([menu('a', E, V(0)), menu('b', E, E)]), menuImages: E }, 'B4'), 'no');
  assert.equal(raw({ menus: E, menuImages: V(0) }, 'B4'), 'no');
  assert.equal(st({ menus: V([menu('a', E, V(0))]), menuImages: M }, 'B4'), 'unknown');
  assert.equal(st({ menus: V([menu('a', E, M)]), menuImages: E }, 'B4'), 'unknown');
  assert.equal(st({ menus: M, menuImages: E }, 'B4'), 'unknown');
});

test('B5: totalImages value → 수치 판정 (3 → fail) / missing → unknown', () => {
  assert.equal(st({ totalImages: V(3) }, 'B5'), 'fail');
  assert.equal(raw({ totalImages: V(3) }, 'B5'), 3);
  assert.equal(st({ totalImages: V(23) }, 'B5'), 'pass');
  assert.equal(st({ totalImages: V(10) }, 'B5'), 'partial');
  assert.equal(st({ totalImages: M }, 'B5'), 'unknown');
  assert.equal(st({ totalImages: V('23') }, 'B5'), 'unknown');
});

test('B6: 첫 페이지 최댓값으로 판정(최신순 실측) / 빈 목록은 complete=true일 때만 fail', () => {
  const f = (createdAt) => ({ createdAt, category: '알림', desc: '' });
  assert.equal(raw({ feeds: V([f('2026-08-15')]), feedsComplete: V(false) }, 'B6'), '2026-08-15');
  assert.equal(st({ feeds: V([f('2026-08-15')]), feedsComplete: V(false) }, 'B6'), 'pass');
  assert.equal(st({ feeds: V([f('2026-08-14')]), feedsComplete: V(false) }, 'B6'), 'partial');
  assert.equal(st({ feeds: V([f('2026-08-14')]), feedsComplete: M }, 'B6'), 'partial');
  assert.equal(st({ feeds: V([f('2026-08-14')]), feedsComplete: V(true) }, 'B6'), 'partial');
  assert.equal(st({ feeds: V([f('2026-06-15')]), feedsComplete: V(true) }, 'B6'), 'fail');
  assert.equal(raw({ feeds: V([]), feedsComplete: V(true) }, 'B6'), 'none');
  assert.equal(st({ feeds: E, feedsComplete: V(true) }, 'B6'), 'fail');
  assert.equal(st({ feeds: V([]), feedsComplete: V(false) }, 'B6'), 'unknown');
  assert.equal(st({ feeds: M, feedsComplete: V(true) }, 'B6'), 'unknown');
  // 최신순 보장 안 돼도 최댓값 사용
  assert.equal(raw({ feeds: V([f('2026-06-01'), f('2026-09-10')]), feedsComplete: V(false) }, 'B6'), '2026-09-10');
  // 미래·형식 오류 날짜만 → unknown
  assert.equal(st({ feeds: V([f('2026-09-20')]), feedsComplete: V(true) }, 'B6'), 'unknown');
  assert.equal(st({ feeds: V([f('20260910')]), feedsComplete: V(true) }, 'B6'), 'unknown');
});

test('B7: homepages non-empty → yes / empty → no / missing → unknown', () => {
  assert.equal(raw({ homepages: V(['https://x']) }, 'B7'), 'yes');
  assert.equal(raw({ homepages: V([]) }, 'B7'), 'no');
  assert.equal(raw({ homepages: E }, 'B7'), 'no');
  assert.equal(st({ homepages: M }, 'B7'), 'unknown');
});

test('C1: using true → on / false → off / missing: URL value → on, else unknown', () => {
  assert.equal(raw({ naverBookingUsing: V(true) }, 'C1'), 'on');
  assert.equal(raw({ naverBookingUsing: V(false), naverBookingUrl: V('https://b') }, 'C1'), 'off');
  assert.equal(st({ naverBookingUsing: V(false) }, 'C1'), 'fail');
  assert.equal(raw({ naverBookingUsing: M, naverBookingUrl: V('https://b') }, 'C1'), 'on');
  assert.equal(st({ naverBookingUsing: M, naverBookingUrl: E }, 'C1'), 'unknown');
  assert.equal(st({ naverBookingUsing: V('true'), naverBookingUrl: E }, 'C1'), 'unknown');
  assert.equal(st({}, 'C1'), 'unknown');
});

test('C2: smartCall true 또는 talktalk value → yes / false and empty → no / 그 외 unknown', () => {
  assert.equal(raw({ smartCallUsing: V(true), talktalkUrl: E }, 'C2'), 'yes');
  assert.equal(raw({ smartCallUsing: V(false), talktalkUrl: V('https://t') }, 'C2'), 'yes');
  assert.equal(raw({ smartCallUsing: M, talktalkUrl: V('https://t') }, 'C2'), 'yes');
  assert.equal(raw({ smartCallUsing: V(false), talktalkUrl: E }, 'C2'), 'no');
  assert.equal(st({ smartCallUsing: V(false), talktalkUrl: M }, 'C2'), 'unknown');
  assert.equal(st({ smartCallUsing: M, talktalkUrl: E }, 'C2'), 'unknown');
});

test('C3: 쿠폰 ≥1 → yes / 0 + EVENT 기간 판정 (자정 경계) / feeds missing·incomplete → unknown', () => {
  const ev = { createdAt: '2026-09-01', category: 'EVENT', period: '2026.09.15. ~ 2026.09.20.', periodStart: '2026-09-15', periodEnd: '2026-09-20', desc: '' };
  const base = { hasCouponCount: V(0), feeds: V([ev]), feedsComplete: V(true) };
  assert.equal(raw(base, 'C3', '2026-09-14'), 'no');            // R3-1: 예정 → fail
  assert.equal(st(base, 'C3', '2026-09-14'), 'fail');
  assert.equal(raw(base, 'C3', '2026-09-15'), 'yes');           // 캐시 hit, 새 as_of → pass
  assert.equal(raw(base, 'C3', '2026-09-20'), 'yes');           // 종료일 포함
  assert.equal(raw(base, 'C3', '2026-09-21'), 'no');            // 만료
  assert.equal(raw({ hasCouponCount: V(2), feeds: M }, 'C3'), 'yes');
  assert.equal(raw({ hasCouponCount: V(0), feeds: V([]), feedsComplete: V(true) }, 'C3'), 'no');
  assert.equal(raw({ hasCouponCount: V(0), feeds: E, feedsComplete: V(true) }, 'C3'), 'no');
  assert.equal(st({ hasCouponCount: V(0), feeds: M }, 'C3'), 'unknown');
  assert.equal(st({ hasCouponCount: V(0), feeds: V([]), feedsComplete: V(false) }, 'C3'), 'unknown');
  assert.equal(st({ hasCouponCount: M, feeds: V([]), feedsComplete: V(true) }, 'C3'), 'unknown');
  // 기간 missing인 EVENT → unknown (진행 중 EVENT가 따로 있으면 pass)
  const noPeriod = { ...ev, period: null, periodStart: undefined, periodEnd: undefined };
  assert.equal(st({ hasCouponCount: V(0), feeds: V([noPeriod]), feedsComplete: V(true) }, 'C3'), 'unknown');
  const live = { ...ev, periodStart: '2026-09-10', periodEnd: '2026-09-14' };
  assert.equal(raw({ hasCouponCount: V(0), feeds: V([noPeriod, live]), feedsComplete: V(true) }, 'C3'), 'yes');
  assert.equal(raw({ hasCouponCount: M, feeds: V([live]), feedsComplete: V(false) }, 'C3'), 'yes'); // 긍정 증거 우선
  // 알림 카테고리는 무시
  assert.equal(raw({ hasCouponCount: V(0), feeds: V([{ ...live, category: '알림' }]), feedsComplete: V(true) }, 'C3'), 'no');
});

test('C4: conveniences 또는 parkingInfo value → yes / 자동 empty → unknown', () => {
  assert.equal(raw({ conveniences: V(['주차']) }, 'C4'), 'yes');
  assert.equal(raw({ conveniences: E, parkingInfo: V('주차 불가') }, 'C4'), 'yes');
  assert.equal(st({ conveniences: E, parkingInfo: E }, 'C4'), 'unknown');
  assert.equal(st({ conveniences: V([]), parkingInfo: V('') }, 'C4'), 'unknown');
});

test('D1·D2: 총수 0 → D1 fail(none), D2 na / 그 외 unknown (날짜 SSR 없음)', () => {
  const r = run({ visitorReviewsTotal: V(0) });
  assert.equal(r.answers.D1, 'none');
  assert.equal(r.auto.D1.state, 'fail');
  assert.equal(r.auto.D2.state, 'na');
  assert.ok(!('D2' in r.answers));
  assert.equal(computeScore(r.answers, { asOf: AS }).items.find(i => i.id === 'D2').state, 'na');
  const r2 = run({ visitorReviewsTotal: V(120), latestVisitorReviewDate: M, latestOwnerReplyDate: M });
  assert.equal(r2.auto.D1.state, 'unknown');
  assert.equal(r2.auto.D2.state, 'unknown');
  assert.ok(!('D1' in r2.answers));
});

test('D3: 범위(description+feeds) 전부 읽힘 → 검사 / 전부 empty → pass(clean) / 검출 → fail / 일부 missing → unknown', () => {
  assert.equal(raw({ description: E, feeds: E }, 'D3'), 'clean');
  assert.equal(st({ description: E, feeds: E }, 'D3'), 'pass');
  assert.equal(st({ description: V('   '), feeds: V([]) }, 'D3'), 'pass');
  assert.equal(st({ description: V('정성껏 만듭니다'), feeds: V([{ desc: '추석 연휴 휴무' }]) }, 'D3'), 'pass');
  assert.equal(st({ description: V('리뷰 쓰면 음료 무료'), feeds: E }, 'D3'), 'fail');
  assert.equal(st({ description: E, feeds: V([{ desc: '별점 5개 부탁드려요' }]) }, 'D3'), 'fail');
  assert.equal(st({ description: M, feeds: E }, 'D3'), 'unknown');
  assert.equal(st({ description: V('x'), feeds: M }, 'D3'), 'unknown');
  // 소식 11번째 이후는 검사 범위 밖
  const feeds = Array.from({ length: 11 }, (_, i) => ({ desc: i === 10 ? '리뷰 쓰면 무료' : '정상 영업' }));
  assert.equal(st({ description: E, feeds: V(feeds) }, 'D3'), 'pass');
  assert.equal(st({ description: E, feeds: V(feeds.slice(1)) }, 'D3'), 'fail');
});

test('실측 픽스처 (lib/place-parse.js 있을 때만)', { skip: !fs.existsSync(path.join(__dirname, '../lib/place-parse.js')) && 'lib/place-parse.js 미작성 — 다른 에이전트 작업 중' }, () => {
  const P = require('../lib/place-parse');
  const fx = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
  let facts = P.parseHome(fx('kise-anguk-home.html'));
  assert.ok(facts, 'parseHome');
  facts = P.parseInformation(fx('kise-anguk-information.html'), facts);
  facts = P.parseFeed(fx('kise-anguk-feed.html'), facts);
  facts = P.parsePhoto(fx('kise-anguk-photo.html'), facts);
  const { answers, auto } = run(facts);
  const STATES = ['pass', 'partial', 'fail', 'unknown', 'na'];
  assert.equal(Object.keys(auto).length, 18);
  Object.entries(auto).forEach(([id, a]) => assert.ok(STATES.includes(a.state), id + ':' + a.state));
  Object.keys(answers).forEach(id => assert.notEqual(auto[id].state, 'unknown', id));
  // 07번 실측: 안국역점 상세설명 장문, 키워드 5, 사진 23, 쿠폰 1, 예약·스마트콜 플래그 존재
  assert.equal(auto.B2.state, 'pass');
  assert.equal(auto.B5.state, 'pass');
  assert.equal(auto.C3.state, 'pass');
  assert.equal(auto.B1.state, 'pass');
  assert.equal(auto.D1.state, 'unknown');
  const r = computeScore(answers, { asOf: AS });
  assert.ok(r.coverage >= 0.5, 'coverage ' + r.coverage);
});
