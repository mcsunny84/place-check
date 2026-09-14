'use strict';
// pcmap SSR의 window.__APOLLO_STATE__ → Facts (docs/08 계약, docs/07 실측 위치)

const MISSING = Object.freeze({ status: 'missing' });
const EMPTY = Object.freeze({ status: 'empty' });

// undefined → missing / null·''·[] → empty / 타입 불일치 → missing / 그 외 value
function obs(v, type) {
  if (v === undefined) return MISSING;
  if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) return EMPTY;
  if (type && (type === 'array' ? !Array.isArray(v) : typeof v !== type)) return MISSING;
  return { status: 'value', value: v };
}

// 경로 조회: 중간 키 부재 → undefined, 중간 값 null → null (present-but-empty)
function get(o, path) {
  for (const k of path.split('.')) {
    if (o === null) return null;
    if (o === undefined || typeof o !== 'object') return undefined;
    o = o[k];
  }
  return o;
}

const deref = (st, v) => (v && typeof v === 'object' && v.__ref ? st[v.__ref] : v);

function extractApollo(html) {
  if (typeof html !== 'string') return null;
  const i = html.indexOf('window.__APOLLO_STATE__');
  if (i < 0) return null;
  const s = html.indexOf('{', i);
  if (s < 0) return null;
  // 문자열 내부의 중괄호를 무시하며 최상위 객체의 끝을 찾는다
  let depth = 0, inStr = false, esc = false;
  for (let k = s; k < html.length; k++) {
    const c = html[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { const o = JSON.parse(html.slice(s, k + 1)); return o && typeof o === 'object' ? o : null; } catch { return null; }
    }
  }
  return null;
}

// ROOT_QUERY.placeDetail({...}) 객체
function placeDetail(st) {
  const rq = st && st.ROOT_QUERY;
  if (!rq) return null;
  const key = Object.keys(rq).find((k) => k.startsWith('placeDetail('));
  return key ? deref(st, rq[key]) : null;
}

// 참조 배열 → 엔터티 배열. 하나라도 미해결이면 undefined(missing)
function derefList(st, arr) {
  if (!Array.isArray(arr)) return arr;
  const out = arr.map((r) => deref(st, r));
  return out.some((e) => e === undefined) ? undefined : out;
}

const WIDE_RE = /(특별시|광역시|특별자치시|특별자치도|도)$/;
function districtTokens(roadAddress) {
  if (typeof roadAddress !== 'string') return obs(roadAddress);
  return obs(roadAddress.split(/\s+/).filter((t) => t && !WIDE_RE.test(t)).slice(0, 3), 'array');
}

function toolUsing(pd, type) {
  const tools = get(pd, 'businessTools.tools');
  if (!Array.isArray(tools)) return MISSING;
  const t = tools.find((x) => x && x.type === type);
  return t ? obs(t.using, 'boolean') : MISSING;
}

function businessHours(pd) {
  const list = get(pd, 'newBusinessHours.0.businessHours');
  const o = obs(list, 'array');
  if (o.status !== 'value') return o;
  return {
    status: 'value',
    value: list.map((d) => ({
      day: d.day,
      start: get(d, 'businessHours.start'),
      end: get(d, 'businessHours.end'),
      breaks: (d.breakHours || []).map((b) => ({ start: b.start, end: b.end })),
    })),
  };
}

function homepages(pd) {
  const h = pd.homepages;
  if (h === undefined) return MISSING;
  if (h === null) return EMPTY;
  const urls = [
    get(h, 'repr.url'),
    ...(h.etc || []).map((e) => e && e.url),
    ...(h.subLinks || []).map((s) => (typeof s === 'string' ? s : s && s.url)),
  ];
  return obs(urls.filter((u) => typeof u === 'string' && u), 'array');
}

function menus(st, pd) {
  const list = derefList(st, pd.menus);
  const o = obs(list, 'array');
  if (o.status !== 'value') return o;
  return {
    status: 'value',
    value: list.map((m, i) => ({
      name: m.name,
      price: obs(m.price, 'string'),
      images: Array.isArray(m.images) ? obs(m.images.length || null) : obs(m.images),
      recommend: m.recommend === true,
      order: i,
    })),
  };
}

function subwayStations(st, pd) {
  const list = derefList(st, pd.subwayStations);
  const o = obs(list, 'array');
  if (o.status !== 'value') return o;
  const infos = list.map((s) => deref(st, s && s.station));
  if (infos.some((x) => !x || typeof x.name !== 'string')) return MISSING;
  return { status: 'value', value: infos.map((x) => x.name) };
}

function parseHome(html, { now } = {}) {
  const st = extractApollo(html);
  const pd = placeDetail(st);
  const base = pd && deref(st, pd.base);
  if (!base || base.__typename !== 'PlaceDetailBase') return null;
  const fsasTotal = get(pd, 'fsasReviews.total');
  return {
    placeId: obs(base.id, 'string'),
    name: obs(base.name, 'string'),
    category: obs(base.category, 'string'),
    roadAddress: obs(base.roadAddress, 'string'),
    district_tokens: districtTokens(base.roadAddress),
    phone: obs(base.phone, 'string'),
    virtualPhone: obs(base.virtualPhone, 'string'),
    talktalkUrl: obs(base.talktalkUrl, 'string'),
    naverBookingUsing: toolUsing(pd, 'naverBooking'),
    smartCallUsing: toolUsing(pd, 'smartCall'),
    naverBookingUrl: obs(get(pd, 'naverBooking.naverBookingUrl'), 'string'),
    businessHours: businessHours(pd),
    hideBusinessHours: obs(base.hideBusinessHours, 'boolean'),
    description: MISSING, // /information 탭에서 채움 (home의 base.description은 항상 '')
    keywords: obs(get(pd, 'informationTab.keywordList'), 'array'),
    accessor: obs(get(pd, 'accessor.accessor'), 'string'),
    homepages: homepages(pd),
    menus: menus(st, pd),
    menuImages: Array.isArray(pd.menuImages) ? obs(pd.menuImages.length || null) : obs(pd.menuImages),
    conveniences: obs(base.conveniences, 'array'),
    parkingInfo: obs(get(pd, 'informationTab.parkingInfo.description'), 'string'),
    subwayStations: subwayStations(st, pd),
    visitorReviewsTotal: obs(base.visitorReviewsTotal, 'number'),
    visitorReviewsScore: obs(base.visitorReviewsScore, 'number'),
    blogReviewsTotal: obs(typeof fsasTotal === 'number' ? fsasTotal : base.cafeBlogReviewsTotal, 'number'),
    hasCouponCount: obs(get(pd, 'hasCoupon.count'), 'number'),
    feeds: MISSING,
    feedsComplete: MISSING,
    totalImages: MISSING,
    topPhotosTotal: MISSING,
    latestVisitorReviewDate: MISSING, // SSR에 없음 (docs/07 #11)
    latestOwnerReplyDate: MISSING,
    fetched_at: (now ? new Date(now) : new Date()).toISOString(),
  };
}

function parseInformation(html, facts) {
  const pd = placeDetail(extractApollo(html));
  return { ...facts, description: pd ? obs(pd.description, 'string') : MISSING };
}

const ymd = (y, m, d) => `${y}-${m}-${d}`;
function feedItem(f) {
  const c = typeof f.createdString === 'string' && /^\d{8}$/.test(f.createdString) ? f.createdString : null;
  const item = {
    createdAt: c ? ymd(c.slice(0, 4), c.slice(4, 6), c.slice(6, 8)) : null,
    category: f.category,
    period: typeof f.period === 'string' ? f.period : null,
    isPinned: f.isPinned === true,
    title: f.title,
    desc: f.desc,
  };
  const dates = [...(item.period || '').matchAll(/(\d{4})\.(\d{2})\.(\d{2})\./g)].map((m) => ymd(m[1], m[2], m[3]));
  if (dates.length) { item.periodStart = dates[0]; item.periodEnd = dates[dates.length - 1]; }
  return item;
}

function parseFeed(html, facts) {
  const st = extractApollo(html);
  const rq = st && st.ROOT_QUERY;
  const key = rq && Object.keys(rq).find((k) => k.startsWith('feeds('));
  const fr = key ? deref(st, rq[key]) : undefined;
  if (!fr || typeof fr !== 'object') return { ...facts, feeds: MISSING, feedsComplete: MISSING };
  const list = derefList(st, fr.feeds);
  const o = obs(list, 'array');
  return {
    ...facts,
    feeds: o.status === 'value' ? { status: 'value', value: list.map(feedItem) } : o, // 원본 순서(최신순) 유지
    feedsComplete: typeof fr.hasMore === 'boolean' ? { status: 'value', value: !fr.hasMore } : MISSING,
  };
}

function parsePhoto(html, facts) {
  const pd = placeDetail(extractApollo(html));
  return {
    ...facts,
    totalImages: pd ? obs(get(pd, 'images.totalImages'), 'number') : MISSING,
    topPhotosTotal: pd ? obs(get(pd, 'topPhotos.total'), 'number') : MISSING,
  };
}

module.exports = { extractApollo, parseHome, parseInformation, parseFeed, parsePhoto };
