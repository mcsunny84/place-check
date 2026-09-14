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
    description: obs(pd.description, 'string'), // placeDetail.description (base.description은 구필드 — 항상 '')
    keywords: obs(get(pd, 'informationTab.keywordList'), 'array'),
    road: obs(base.road, 'string'), // 찾아오는 길 안내문 (07번 추가 실측). accessor는 '업주 정보'라 무관
    accessor: obs(get(pd, 'accessor.accessor'), 'string'),
    phonePrivate: obs(get(pd, 'phoneInfo.isPrivatePhone'), 'boolean'), // 전화번호 비공개 설정 여부
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
    blogTitles: (function () { const l = derefList(st, get(pd, 'fsasReviews.items')); return Array.isArray(l) ? { status: 'value', value: l.map((x) => x && x.title).filter((t) => typeof t === 'string') } : MISSING; })(),
    feeds: MISSING,
    feedsComplete: MISSING,
    reviews: MISSING,      // /review/visitor 탭에서 채움
    reviewStats: MISSING,
    totalImages: obs(get(pd, 'images.totalImages'), 'number'), // 홈에도 있음(photo 탭 불필요)
    topPhotosTotal: obs(get(pd, 'topPhotos.total'), 'number'),
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

// 방문자 리뷰 날짜: '9.12.토' | '2025.3.1.토' | '9.12' → YYYY-MM-DD. 연도 없으면 기준일(now) 기준 최근 과거로 추정.
function reviewDate(s, now) {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(?:(\d{2}|\d{4})\.)?(\d{1,2})\.(\d{1,2})\.?/);
  if (!m) return null;
  const base = now ? new Date(now) : new Date();
  let y = m[1] ? (m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1])) : base.getFullYear(); // '25.12.5.금' 형식(2자리 연도)
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  if (!m[1]) {
    const cand = new Date(Date.UTC(y, mo - 1, d));
    const today = new Date(Date.UTC(base.getFullYear(), base.getMonth(), base.getDate()));
    if (cand > today) y -= 1; // 미래면 작년
  }
  return ymd(y, String(mo).padStart(2, '0'), String(d).padStart(2, '0'));
}

// /review/visitor 탭: 최근 방문자 리뷰(최대 20, 본문은 10) + 전체 리뷰 통계(테마·메뉴·투표 키워드). 07번 실측.
function parseReviewVisitor(html, facts, { now } = {}) {
  const st = extractApollo(html);
  const pd = placeDetail(st);
  if (!st || !pd) return { ...facts, reviews: MISSING, reviewStats: MISSING };
  const rq = st.ROOT_QUERY;
  const keys = Object.keys(rq).filter((k) => k.startsWith('visitorReviews('));
  const items = [];
  for (const k of keys) {
    const r = deref(st, rq[k]);
    const list = r && derefList(st, r.items);
    if (Array.isArray(list)) for (const v of list) if (v && typeof v === 'object') items.push(v);
  }
  const reviews = dedupeReviews(items.map((v) => normalizeReview(v, now)));
  const statsKey = Object.keys(rq).find((k) => k.startsWith('visitorReviewStats('));
  const stats = statsKey ? deref(st, rq[statsKey]) : null;
  const a = stats && stats.analysis;
  const pick = (arr, nameKey) => (Array.isArray(arr) ? arr.filter((x) => x && typeof x.count === 'number').map((x) => ({ name: x[nameKey], count: x.count })) : []);
  const reviewStats = stats && typeof stats === 'object' ? {
    status: 'value',
    value: {
      totalCount: get(stats, 'review.totalCount') ?? null,
      avgRating: get(stats, 'review.avgRating') ?? null,
      themes: pick(a && a.themes, 'label'),
      menus: pick(a && a.menus, 'label'),
      votedKeywords: pick(get(a, 'votedKeyword.details'), 'displayName'),
      votedTotal: get(a, 'votedKeyword.totalCount') ?? null,
    },
  } : MISSING;
  return { ...facts, reviews: keys.length ? { status: 'value', value: reviews } : MISSING, reviewStats };
}

// GraphQL(visitorReviews) 아이템과 SSR 엔터티는 같은 shape — 공용 정규화
function normalizeReview(v, now) {
  if (!v || typeof v !== 'object') return null;
  const id = v.id || v.reviewId; if (!id) return null;
  return {
      id: String(id),
      visited: reviewDate(v.visited, now), created: reviewDate(v.created, now),
      rating: typeof v.rating === 'number' ? v.rating : null,
      body: typeof v.body === 'string' ? v.body : null,
      replyCreated: v.reply && typeof v.reply === 'object' ? reviewDate(v.reply.created, now) : null,
      hasReply: !!(v.reply && typeof v.reply === 'object' && v.reply.body),
      votedKeywords: Array.isArray(v.votedKeywords) ? v.votedKeywords.map((x) => x && x.name).filter(Boolean) : [],
      visitCategories: Array.isArray(v.visitCategories) ? v.visitCategories.flatMap((c) => (c && Array.isArray(c.keywords) ? c.keywords.map((x) => x && x.name).filter(Boolean) : [])) : [],
      cursor: typeof v.cursor === 'string' ? v.cursor : null,
  };
}
function dedupeReviews(list) {
  const seen = new Set(); const out = [];
  for (const r of list) { if (!r || seen.has(r.id)) continue; seen.add(r.id); out.push(r); }
  return out;
}

module.exports = { extractApollo, parseHome, parseInformation, parseFeed, parsePhoto, parseReviewVisitor, reviewDate, normalizeReview, dedupeReviews };
