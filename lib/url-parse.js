'use strict';
// 네이버 플레이스 URL → placeId (docs/08 계약, docs/04 §6 지원 목록)

const URL_RE = /https?:\/\/[^\s<>"'”’]+/;
const UNSUPPORTED = { ok: false, reason: 'unsupported' };
const isId = (s) => /^\d+$/.test(s || '');
const found = (placeId, type) => ({ ok: true, placeId, type, needsResolve: false });

function parsePlaceUrl(input) {
  const m = String(input || '').match(URL_RE);
  if (!m) return { ok: false, reason: 'no_url' };
  let u;
  try { u = new URL(m[0].replace(/[.,;:!?)\]]+$/, '')); } catch { return UNSUPPORTED; }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean); // 경로 세그먼트만 본다. 쿼리·해시 무시

  if (host === 'naver.me') {
    return seg.length === 1 ? { ok: true, shortUrl: u.href, needsResolve: true } : UNSUPPORTED;
  }
  if (host === 'm.place.naver.com' || host === 'pcmap.place.naver.com') {
    // /{type}/{id}(/{tab})?
    return /^[a-z]+$/i.test(seg[0] || '') && isId(seg[1]) ? found(seg[1], seg[0]) : UNSUPPORTED;
  }
  if (host === 'map.naver.com') {
    // /p/entry/place/{id}, /v5/entry/place/{id}
    if ((seg[0] === 'p' || seg[0] === 'v5') && seg[1] === 'entry' && seg[2] === 'place' && isId(seg[3])) return found(seg[3], null);
    // /p/search/{q}/place/{id}
    if (seg[0] === 'p' && seg[1] === 'search' && seg[3] === 'place' && isId(seg[4])) return found(seg[4], null);
  }
  return UNSUPPORTED;
}

module.exports = { parsePlaceUrl };
