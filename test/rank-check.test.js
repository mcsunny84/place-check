'use strict';
const test = require('node:test');
const assert = require('node:assert');
const RK = require('../lib/rank-check');

// 2026-11-03 실측 목록 SSR 구조를 줄인 것: placeList.businesses.items(100) + adBusinesses
function listHtml(ids, adIds) {
  const st = { ROOT_QUERY: { __typename: 'Query' } };
  const ref = (id, extra) => { st[`P:${id}`] = { __typename: 'RestaurantListSummary', id, name: `가게${id}`, visitorReviewCount: '1,649', blogCafeReviewCount: '221', saveCount: '~100', ...extra }; return { __ref: `P:${id}` }; };
  st.ROOT_QUERY['placeList({"input":{"display":9}})'] = { businesses: { items: [ref('x1')] } };
  st.ROOT_QUERY['placeList({"input":{"display":100,"query":"안국역맛집"}})'] = {
    businesses: { items: ids.map((id) => ref(id)) },
    adBusinesses: { total: adIds.length, items: adIds.map((id) => ref(`ad${id}`, { id })) },
  };
  return `<script>window.__APOLLO_STATE__ = ${JSON.stringify(st)};window.__PLACE_STATE__={}</script>`;
}

test('parseList: 100개 목록에서 우리 순위·상위 5·광고 집행 여부', () => {
  const ids = Array.from({ length: 100 }, (_, i) => String(1000 + i));
  const r = RK.parseList(listHtml(ids, ['1003', '9']), '1008');
  assert.equal(r.rank, 9);
  assert.equal(r.checked, 100);
  assert.equal(r.top.length, 5);
  assert.deepStrictEqual([r.top[0].reviews, r.top[0].saves, r.top[0].savesText], [1649, 100, '~100']);
  assert.deepStrictEqual(r.ads, { count: 2, ours: false });
  assert.equal(RK.parseList(listHtml(ids, ['1008']), '1008').ads.ours, true);
});

test('parseList: 100위 밖이면 rank null, 아폴로 없으면 null', () => {
  const r = RK.parseList(listHtml(['1', '2'], []), '999');
  assert.equal(r.rank, null);
  assert.equal(r.me, null);
  assert.equal(RK.parseList('<html></html>', '1'), null);
});

test('pickKeywords: 지역 들어간 등록 키워드(검색량 순) 2개 + 검색량 큰 추천, 중복 제거', () => {
  const kw = {
    diagnosis: [{ keyword: '역삼돈까스', volume: 380 }, { keyword: '강남역 돈까스', volume: 1760 }, { keyword: '히레카츠', volume: 5900, labels: ['지역 없음', '너무 넓음'] }, { keyword: '붙여쓰기', volume: 18 }],
    recommendations: [{ keyword: '강남역돈까스', volume: 1760 }, { keyword: '신논현 맛집', volume: 900 }],
  };
  assert.deepStrictEqual(RK.pickKeywords(kw).map((k) => k.keyword), ['강남역 돈까스', '역삼돈까스', '신논현 맛집']);
});

test('listUrl: 업종 경로와 가게 좌표', () => {
  assert.equal(RK.listUrl('hospital', '강남역피부과', { x: '127.02', y: '37.50' }), 'https://pcmap.place.naver.com/hospital/list?query=%EA%B0%95%EB%82%A8%EC%97%AD%ED%94%BC%EB%B6%80%EA%B3%BC&display=100&x=127.02&y=37.50');
  assert.match(RK.listUrl('place', '안국역맛집', null), /^https:\/\/pcmap\.place\.naver\.com\/restaurant\/list\?/);
});
