'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { extractApollo, parseHome, parseInformation, parseFeed, parsePhoto } = require('../lib/place-parse');

const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n + '.html'), 'utf8');
const val = (o) => (assert.strictEqual(o.status, 'value', JSON.stringify(o)), o.value);
const wrap = (state) => `<html><script>window.__APOLLO_STATE__ = ${JSON.stringify(state)};\n window.x=1;</script></html>`;

test('extractApollo: real fixture, missing marker, broken JSON', () => {
  const st = extractApollo(fx('kise-anguk-home'));
  assert.ok(st && st.ROOT_QUERY);
  assert.strictEqual(extractApollo('<html></html>'), null);
  assert.strictEqual(extractApollo('window.__APOLLO_STATE__ = {"a":1,'), null);
  assert.strictEqual(extractApollo('window.__APOLLO_STATE__ = {"a":"}"} ;').a, '}'); // 문자열 안 중괄호
});

test('parseHome kise-anguk', () => {
  const f = parseHome(fx('kise-anguk-home'), { now: '2026-09-14T00:00:00Z' });
  assert.strictEqual(val(f.placeId), '2086785604');
  assert.strictEqual(val(f.name), '키세카츠 안국역점');
  assert.strictEqual(val(f.category), '돈가스');
  assert.deepStrictEqual(val(f.district_tokens), ['서울', '종로구', '율곡로']);
  assert.strictEqual(f.phone.status, 'empty');
  assert.strictEqual(val(f.virtualPhone), '0507-1338-1981');
  assert.match(val(f.talktalkUrl), /^http:\/\/talk\.naver\.com\//);
  assert.strictEqual(val(f.keywords).length, 5);
  const bh = val(f.businessHours);
  assert.strictEqual(bh.length, 7);
  assert.deepStrictEqual(bh.map((d) => d.day), ['월', '화', '수', '목', '금', '토', '일']);
  assert.deepStrictEqual(bh[0], { day: '월', start: '11:00', end: '21:00', breaks: [{ start: '16:00', end: '17:00' }] });
  assert.ok(bh.every((d) => d.breaks.some((b) => b.start === '16:00' && b.end === '17:00')));
  assert.strictEqual(val(f.hideBusinessHours), false);
  assert.strictEqual(val(f.naverBookingUsing), true);
  assert.strictEqual(val(f.smartCallUsing), true);
  assert.match(val(f.naverBookingUrl), /booking\.naver\.com/);
  assert.strictEqual(val(f.hasCouponCount), 1);
  const menus = val(f.menus);
  assert.strictEqual(menus.length, 46);
  assert.strictEqual(menus.filter((m) => m.recommend).length, 7);
  assert.deepStrictEqual(menus[0].price, { status: 'value', value: '19900' });
  assert.deepStrictEqual(menus[0].images, { status: 'value', value: 2 });
  assert.strictEqual(menus[45].order, 45);
  assert.strictEqual(val(f.menuImages), 1);
  assert.deepStrictEqual(val(f.subwayStations), ['안국']);
  assert.ok(val(f.homepages).includes('https://www.instagram.com/kise.katsu'));
  assert.strictEqual(typeof val(f.parkingInfo), 'string');
  assert.strictEqual(f.accessor.status, 'empty');
  assert.ok(val(f.conveniences).includes('주차'));
  assert.strictEqual(val(f.visitorReviewsTotal), 1426);
  assert.strictEqual(val(f.visitorReviewsScore), 4.83);
  assert.strictEqual(val(f.blogReviewsTotal), 196);
  assert.strictEqual(f.description.status, 'missing');
  for (const k of ['feeds', 'feedsComplete', 'totalImages', 'topPhotosTotal', 'latestVisitorReviewDate', 'latestOwnerReplyDate']) {
    assert.strictEqual(f[k].status, 'missing', k);
  }
  assert.strictEqual(f.fetched_at, '2026-09-14T00:00:00.000Z');
  assert.match(parseHome(fx('kise-anguk-home')).fetched_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('parseHome taeksan', () => {
  const f = parseHome(fx('taeksan-home'));
  assert.strictEqual(val(f.naverBookingUsing), false);
  assert.strictEqual(val(f.smartCallUsing), false);
  assert.strictEqual(f.naverBookingUrl.status, 'empty');
  assert.strictEqual(val(f.phone), '054-777-8371');
  assert.strictEqual(val(f.hasCouponCount), 0);
  assert.strictEqual(f.subwayStations.status, 'empty');
  assert.deepStrictEqual(val(f.district_tokens), ['경북', '경주시', '보문로']);
  assert.strictEqual(val(f.menuImages), 5);
});

test('parseHome kise-sinsa subway (transfer station)', () => {
  assert.deepStrictEqual(val(parseHome(fx('kise-sinsa-home')).subwayStations), ['신사']);
});

test('parseInformation fills description, does not mutate input', () => {
  const base = { name: { status: 'value', value: 'x' }, description: { status: 'missing' } };
  const f = parseInformation(fx('kise-anguk-information'), base);
  assert.ok(val(f.description).length > 100);
  assert.strictEqual(val(f.name), 'x');
  assert.strictEqual(base.description.status, 'missing');
  assert.strictEqual(parseInformation('<html></html>', base).description.status, 'missing');
  assert.strictEqual(parseInformation(wrap({ ROOT_QUERY: { 'placeDetail({})': { description: '' } } }), base).description.status, 'empty');
});

test('parseFeed kise-anguk / taeksan / kise-sinsa', () => {
  const base = { feeds: { status: 'missing' } };
  const a = parseFeed(fx('kise-anguk-feed'), base);
  assert.strictEqual(base.feeds.status, 'missing');
  const feeds = val(a.feeds);
  assert.strictEqual(feeds[0].createdAt, '2026-07-21');
  assert.strictEqual(feeds[0].periodStart, '2026-07-21');
  assert.strictEqual(feeds[0].periodEnd, '2026-08-15');
  assert.strictEqual(feeds[0].category, '알림');
  assert.strictEqual(typeof feeds[0].title, 'string');
  assert.strictEqual(typeof feeds[0].isPinned, 'boolean');
  assert.ok(feeds.every((f, i) => i === 0 || feeds[i - 1].createdAt >= f.createdAt), 'newest first');
  const noPeriod = feeds.find((f) => f.period === null);
  assert.ok(noPeriod && !('periodStart' in noPeriod) && !('periodEnd' in noPeriod));
  assert.strictEqual(typeof val(a.feedsComplete), 'boolean');

  const t = val(parseFeed(fx('taeksan-feed'), {}).feeds);
  assert.strictEqual(t[0].period, '2026.07.20.');
  assert.strictEqual(t[0].periodStart, '2026-07-20');
  assert.strictEqual(t[0].periodEnd, '2026-07-20');

  const s = parseFeed(fx('kise-sinsa-feed'), {});
  assert.strictEqual(val(s.feedsComplete), false); // hasMore:true
  assert.strictEqual(parseFeed('<html></html>', {}).feeds.status, 'missing');
});

test('parsePhoto totalImages / topPhotosTotal', () => {
  const a = parsePhoto(fx('kise-anguk-photo'), {});
  assert.strictEqual(val(a.totalImages), 23);
  assert.strictEqual(val(a.topPhotosTotal), 93);
  assert.strictEqual(val(parsePhoto(fx('taeksan-photo'), {}).totalImages), 16);
  assert.strictEqual(parsePhoto('<html></html>', {}).totalImages.status, 'missing');
});

test('parseHome returns null: no marker, broken JSON, no PlaceDetailBase', () => {
  assert.strictEqual(parseHome('<html></html>'), null);
  assert.strictEqual(parseHome('window.__APOLLO_STATE__ = {"ROOT_QUERY":'), null);
  assert.strictEqual(parseHome(wrap({ ROOT_QUERY: { 'placeDetail({})': { base: { __ref: 'PlaceDetailBase:1' } } } })), null);
  assert.strictEqual(parseHome(wrap({ ROOT_QUERY: { 'placeDetail({})': { __typename: 'PlaceDetail' } } })), null);
  assert.strictEqual(parseHome(wrap({ ROOT_QUERY: {} })), null);
});

test('synthetic: absent keys → missing, only placeDetail-referenced Menu/Subway collected', () => {
  const state = {
    ROOT_QUERY: {
      'placeDetail({"input":{"id":"1"}})': {
        __typename: 'PlaceDetail',
        base: { __ref: 'PlaceDetailBase:1' },
        subwayStations: [{ station: { __ref: 'SubwayStationInfo:9' } }],
        hasCoupon: null,
        naverBooking: null,
        businessTools: { tools: [{ type: 'naverBooking', using: 'yes' }] },
      },
    },
    'PlaceDetailBase:1': { __typename: 'PlaceDetailBase', id: '1', name: 'n', conveniences: [], roadAddress: '경기도 성남시 분당구 판교역로 1' },
    'Menu:1_0': { __typename: 'Menu', name: '무관한 메뉴', price: '1000', recommend: true, images: [] },
    'Menu:1_1': { __typename: 'Menu', name: '무관한 메뉴2', price: '1000', recommend: true, images: [] },
    'SubwayStationInfo:9': { __typename: 'SubwayStationInfo', name: '판교' },
    'SubwayStationInfo:10': { __typename: 'SubwayStationInfo', name: '무관' },
  };
  const f = parseHome(wrap(state));
  assert.strictEqual(f.menus.status, 'missing'); // key absent; unrelated Menu:* ignored
  assert.deepStrictEqual(val(f.subwayStations), ['판교']);
  assert.strictEqual(f.conveniences.status, 'empty');
  assert.strictEqual(f.hasCouponCount.status, 'empty');
  assert.strictEqual(f.naverBookingUrl.status, 'empty');
  assert.strictEqual(f.naverBookingUsing.status, 'missing'); // wrong type
  assert.strictEqual(f.smartCallUsing.status, 'missing'); // tool absent
  assert.strictEqual(f.keywords.status, 'missing');
  assert.strictEqual(f.businessHours.status, 'missing');
  assert.strictEqual(f.phone.status, 'missing');
  assert.deepStrictEqual(val(f.district_tokens), ['성남시', '분당구', '판교역로']);

  // menus present but referencing unresolved entity → missing; resolved → only referenced ones
  state.ROOT_QUERY['placeDetail({"input":{"id":"1"}})'].menus = [{ __ref: 'Menu:1_0' }];
  assert.deepStrictEqual(val(parseHome(wrap(state)).menus).map((m) => m.name), ['무관한 메뉴']);
  state.ROOT_QUERY['placeDetail({"input":{"id":"1"}})'].menus = [{ __ref: 'Menu:nope' }];
  assert.strictEqual(parseHome(wrap(state)).menus.status, 'missing');
  state.ROOT_QUERY['placeDetail({"input":{"id":"1"}})'].menus = [];
  assert.strictEqual(parseHome(wrap(state)).menus.status, 'empty');
});
