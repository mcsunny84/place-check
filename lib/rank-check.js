'use strict';
// 키워드 순위 진단 — 네이버 지도 목록(pcmap /{type}/list?query=…&display=100) SSR 한 장에서
// 우리 순위(상위 100 안), 상위 5곳의 리뷰·저장 수, 플레이스 광고 자리 수와 우리 집행 여부를 읽는다.
// 2026-11-03 실측: restaurant·hospital 목록은 placeList.businesses.items 100개, 음식점은 adBusinesses도 같이 온다.
// 순위는 검색 위치(x,y)에 따라 달라지므로 가게 좌표로 검색한다. 가격·광고비는 리포트에 넣지 않는다(태양 11-03).

const LIST_TYPES = ['restaurant', 'hospital', 'hairshop', 'accommodation', 'place'];

function extractApollo(html) {
  const i = typeof html === 'string' ? html.indexOf('__APOLLO_STATE__') : -1;
  if (i < 0) return null;
  const start = html.indexOf('{', i);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, j = start;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) break; }
  }
  try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; }
}

// "1,649" → 1649, "~100" → 100(하한), "4.87" → 4.87, 없음 → null
function num(x) {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string') return null;
  const n = Number(x.replace(/[^\d.]/g, ''));
  return x.replace(/[^\d.]/g, '') && Number.isFinite(n) ? n : null;
}

function parseList(html, placeId) {
  const st = extractApollo(html);
  const rq = st && st.ROOT_QUERY;
  if (!rq) return null;
  const key = Object.keys(rq).filter((k) => rq[k] && rq[k].businesses && Array.isArray(rq[k].businesses.items))
    .sort((a, b) => rq[b].businesses.items.length - rq[a].businesses.items.length)[0]; // display:9(지도 미리보기) 말고 100짜리
  if (!key) return null;
  const node = rq[key];
  const deref = (r) => (r && r.__ref ? st[r.__ref] : r) || {};
  const items = node.businesses.items.map(deref);
  const idx = items.findIndex((it) => String(it.id) === String(placeId));
  const top = items.slice(0, 5).map((it) => ({ name: it.name, reviews: num(it.visitorReviewCount), blog: num(it.blogCafeReviewCount), saves: num(it.saveCount), savesText: typeof it.saveCount === 'string' ? it.saveCount : null }));
  const me = idx >= 0 ? items[idx] : null;
  const ads = node.adBusinesses && Array.isArray(node.adBusinesses.items) ? node.adBusinesses.items.map(deref) : null;
  return {
    rank: idx >= 0 ? idx + 1 : null, checked: items.length,
    top,
    me: me ? { reviews: num(me.visitorReviewCount), blog: num(me.blogCafeReviewCount), saves: num(me.saveCount), savesText: typeof me.saveCount === 'string' ? me.saveCount : null } : null,
    ads: ads ? { count: typeof node.adBusinesses.total === 'number' ? node.adBusinesses.total : ads.length, ours: ads.some((a) => String(a.id) === String(placeId)) } : null,
  };
}

// 진단할 키워드 최대 n개: 등록된 대표키워드(지역 포함, 검색량 순) 우선, 모자라면 검색량 큰 추천 키워드
function pickKeywords(keywords, n = 3) {
  const vol = (k) => (k && k.volume != null ? k.volume : -1);
  // '히레카츠'처럼 지역 없는 키워드는 가게 좌표 검색이면 거의 1위로 나와 오해를 부른다 → 지역 들어간 것만
  const cur = ((keywords && keywords.diagnosis) || []).filter((d) => vol(d) >= 30 && !(d.labels || []).includes('지역 없음')).sort((a, b) => vol(b) - vol(a)).map((d) => ({ keyword: d.keyword, volume: d.volume, registered: true }));
  const rec = [...(((keywords && keywords.llm && keywords.llm.keywords) || [])), ...((keywords && keywords.recommendations) || [])]
    .filter((k) => vol(k) >= 100).sort((a, b) => vol(b) - vol(a)).map((k) => ({ keyword: k.keyword, volume: k.volume, registered: false }));
  const seen = new Set(), out = [];
  for (const k of [...cur.slice(0, 2), ...rec, ...cur.slice(2)]) {
    const c = k.keyword.replace(/\s+/g, '');
    if (seen.has(c)) continue;
    seen.add(c); out.push(k);
    if (out.length >= n) break;
  }
  return out;
}

function listUrl(type, keyword, coord) {
  const t = LIST_TYPES.includes(type) && type !== 'place' ? type : 'restaurant';
  const q = new URLSearchParams({ query: keyword, display: '100' });
  if (coord && coord.x && coord.y) { q.set('x', coord.x); q.set('y', coord.y); }
  return `https://pcmap.place.naver.com/${t}/list?${q}`;
}

// 가게 이름 검색 → 고를 후보. 목록을 못 읽으면 null, 결과가 없으면 [].
function parseSearch(html, max = 8) {
  const st = extractApollo(html);
  const rq = st && st.ROOT_QUERY;
  if (!rq) return null;
  const key = Object.keys(rq).filter((k) => rq[k] && rq[k].businesses && Array.isArray(rq[k].businesses.items))
    .sort((a, b) => rq[b].businesses.items.length - rq[a].businesses.items.length)[0];
  if (!key) return null;
  const s = (x, n) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  return rq[key].businesses.items.map((r) => (r && r.__ref ? st[r.__ref] : r) || {})
    .filter((it) => /^\d{1,20}$/.test(String(it.id)) && s(it.name, 60))
    .slice(0, max)
    .map((it) => ({ id: String(it.id), name: s(it.name, 60), category: s(it.category, 30) || null, address: [s(it.commonAddress, 40), s(it.roadAddress, 40)].filter(Boolean).join(' · ') || null, reviews: num(it.visitorReviewCount) }));
}

module.exports = { parseSearch, parseList, pickKeywords, listUrl, extractApollo, num };
