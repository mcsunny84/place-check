'use strict';
// 구글 지도 프로필 점검 — Google Places API (New). (태양 결정 2026-11-19: API 자동)
// 2026-11-19 실제 조회로 확인한 것:
//  - Places API는 「피부과」 같은 세부 분류를 주지 않는다. 추천이 잘 되는 새솔피부과도, 0회였던 소담봄도 둘 다 doctor.
//    → 분류 일치는 치과(dentist·dental_clinic 형식이 있음)만 자동으로 보고, 나머지는 "상담에서 확인".
//  - 영어 화면 기준 이름은 갈린다. 소담봄 = "sdbom clinic"(챗GPT 지도 카드에 뜬 이름과 같음), 새솔 = "새솔피부과의원".
//    → 한국어로 찾아 병원을 맞춘 뒤, 그 장소의 영어 화면 이름을 한 번 더 받아 "한글 이름·진료과 단어"를 본다.
const { keyOf, coreOf } = require('./probe');

const SEARCH_KRW = 52, DETAIL_KRW = 25; // Text Search Enterprise $35/1,000, Place Details(이름) Pro $17/1,000. 무료 구간은 계산에 넣지 않는다
const EST_KRW = SEARCH_KRW + DETAIL_KRW;
const TTL_MS = 7 * 24 * 3600 * 1000;
const FIELDS = 'places.id,places.displayName,places.primaryType,places.primaryTypeDisplayName,places.types,places.rating,places.userRatingCount,places.googleMapsUri';
// 진료과 → 이름에서 찾을 말(한글·영어)
const DEPT_HINT = {
  치과: /치과|dent/i, 피부과: /피부|dermat|skin/i, 성형외과: /성형|plastic|aesthetic/i, 안과: /안과|eye|ophthalm/i, 한의원: /한의|korean medicine|oriental/i,
  정형외과: /정형|orthop/i, 산부인과: /산부인과|여성|obgyn|gyn|women/i, 이비인후과: /이비인후|\bent\b|otolaryn/i, 비뇨의학과: /비뇨|urolog/i, 통증의학과: /통증|pain/i,
};
const INFLIGHT = new Map(); // 같은 병원 조회가 동시에 여러 번 나가지 않게
const CAT_TYPES = { 치과: /^(dentist|dental_clinic)$/ }; // Places 형식 목록에 진료과가 따로 있는 경우만

function classify(place, dept, enName) {
  const ko = place.displayName?.text || '';
  const shown = enName || ko; // 영어 화면(챗GPT 지도 카드)에 뜨는 이름
  const hint = DEPT_HINT[dept];
  const ct = CAT_TYPES[dept];
  const types = place.types || [];
  return {
    shownName: shown,
    hangul: /[가-힣]/.test(shown),
    inName: hint ? hint.test(shown) : null,
    category: ct ? (types.some((t) => ct.test(t)) ? 'match' : 'other') : 'unverifiable',
  };
}

async function call(deps, url, init) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15_000);
  try { const r = await deps.fetch(url, { ...init, signal: ctl.signal }); return { status: r.status, j: await r.json().catch(() => null) }; }
  catch { return { status: 0, j: null }; } finally { clearTimeout(timer); }
}

async function lookup({ name, address, dept }, deps) {
  const key = deps.env.GOOGLE_PLACES_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const area = String(address || '').split('·')[0].trim().split(/\s+/).slice(0, 3).join(' ');
  // 보관은 장소 원자료만(진료과 판정은 요청마다 다시 한다 — 진료과를 고쳐 다시 물어도 맞게)
  const ck = 'gp3|' + keyOf(name) + '|' + area;
  const hit = deps.cache.get(ck);
  if (hit && deps.now() - hit.at < TTL_MS) return present(hit.raw, dept);
  const inflight = deps.inflight || INFLIGHT;
  if (inflight.has(ck)) return present(await inflight.get(ck), dept);
  if (!deps.budget.reserve(EST_KRW)) return { ok: false, reason: 'budget' };
  const job = fetchRaw(name, area, key, deps).finally(() => inflight.delete(ck));
  inflight.set(ck, job);
  const raw = await job;
  if (raw.ok && (!raw.found || raw.enName)) deps.cache.set(ck, { at: deps.now(), raw }); // 영어 이름을 못 받았으면 보관하지 않는다
  return present(raw, dept);
}

function present(raw, dept) {
  if (!raw.ok || !raw.found) return raw;
  const p = raw.place;
  const c = classify(p, dept, raw.enName);
  return { ok: true, found: true, name: p.displayName?.text || '', label: p.primaryTypeDisplayName?.text || null, type: p.primaryType || null,
    rating: p.rating ?? null, reviews: p.userRatingCount ?? 0, url: p.googleMapsUri || null, ...c,
    enChecked: !!raw.enName, ...(raw.enName ? {} : { hangul: null, inName: null }) };
}

async function fetchRaw(name, area, key, deps) {
  const s = await call(deps, 'https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery: (name + ' ' + area).trim(), languageCode: 'ko', regionCode: 'KR', pageSize: 5 }),
  });
  if (s.status !== 200 || !s.j) { deps.budget.settle(s.status === 0 || s.status >= 500 ? SEARCH_KRW : 0, EST_KRW); return { ok: false, reason: 'api_' + s.status }; }
  // 이름이 똑같은 곳을 먼저 찾고, 없을 때만 지점 표시를 뗀 핵심 이름이 같은 곳(라온치과 ≠ 라온미소치과)
  const list = s.j.places || [];
  const full = keyOf(name), core = coreOf(name);
  const place = list.find((p) => keyOf(p.displayName?.text || '') === full)
    || list.find((p) => core.length >= 2 && coreOf(p.displayName?.text || '') === core);
  let raw, spent = SEARCH_KRW;
  if (!place) raw = { ok: true, found: false, candidates: list.slice(0, 3).map((p) => p.displayName?.text).filter(Boolean) };
  else {
    let enName = null;
    if (place.id) {
      const d = await call(deps, 'https://places.googleapis.com/v1/places/' + encodeURIComponent(place.id) + '?languageCode=en', { headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'displayName' } });
      spent += DETAIL_KRW; // 실패해도 나갔을 수 있으니 친다
      if (d.status === 200 && d.j) enName = d.j.displayName?.text || null;
    }
    raw = { ok: true, found: true, place, enName };
  }
  deps.budget.settle(spent, EST_KRW);
  return raw;
}

module.exports = { lookup, classify, EST_KRW };
