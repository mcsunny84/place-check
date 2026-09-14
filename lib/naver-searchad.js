'use strict';
// 네이버 검색광고 키워드도구 API — 월간 검색수(PC·모바일). 광고 계정의 API 라이선스 3종 필요.
//   .env: NAVER_AD_API_KEY(액세스 라이선스), NAVER_AD_SECRET(비밀키), NAVER_AD_CUSTOMER_ID(광고주 ID)
// 문서: 검색광고 > 도구 > API 사용 관리 → 라이선스 발급. 엔드포인트 GET https://api.naver.com/keywordstool
const crypto = require('node:crypto');

const BASE = 'https://api.naver.com';
const compact = (s) => String(s || '').replace(/\s+/g, '');

function creds(env = process.env) {
  const k = env.NAVER_AD_API_KEY, s = env.NAVER_AD_SECRET, c = env.NAVER_AD_CUSTOMER_ID;
  return k && s && c ? { key: k, secret: s, customer: c } : null;
}

function sign(secret, timestamp, method, uri) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

function headers(c, method, uri, now = Date.now()) {
  const ts = String(now);
  return { 'X-Timestamp': ts, 'X-API-KEY': c.key, 'X-Customer': String(c.customer), 'X-Signature': sign(c.secret, ts, method, uri), 'content-type': 'application/json' };
}

// "< 10" 같은 문자열도 숫자로. 알 수 없으면 null.
function num(x) {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') { const m = x.match(/\d+/); if (/^<\s*\d+$/.test(x.trim())) return Number(m[0]) - 1; return m ? Number(m[0]) : null; }
  return null;
}

/**
 * 키워드 목록의 월간 검색수 조회. 5개씩 hintKeywords로 나눠 호출, 응답 중 정확히 일치(공백 무시)하는 항목만 사용.
 * @returns {Promise<Object<string,{pc:number|null,mobile:number|null,total:number|null,comp:string|null}>>}
 */
async function getKeywordVolumes(keywords, { fetchImpl = globalThis.fetch, env = process.env, now } = {}) {
  const c = creds(env);
  if (!c) return null;
  const uniq = [...new Set((keywords || []).map((k) => String(k || '').trim()).filter(Boolean))];
  const out = {};
  for (let i = 0; i < uniq.length; i += 5) {
    const batch = uniq.slice(i, i + 5);
    const uri = '/keywordstool';
    const url = `${BASE}${uri}?hintKeywords=${encodeURIComponent(batch.map(compact).join(','))}&showDetail=1`;
    const res = await fetchImpl(url, { headers: headers(c, 'GET', uri, now), signal: AbortSignal.timeout(8000) });
    if (!res || res.status !== 200) { const t = res && typeof res.text === 'function' ? (await res.text()).slice(0, 200) : ''; throw new Error(`searchad ${res && res.status}: ${t}`); }
    const j = await res.json();
    const list = Array.isArray(j.keywordList) ? j.keywordList : [];
    for (const kw of batch) {
      const hit = list.find((x) => compact(x.relKeyword) === compact(kw));
      if (!hit) { out[kw] = { pc: null, mobile: null, total: null, comp: null }; continue; }
      const pc = num(hit.monthlyPcQcCnt), mobile = num(hit.monthlyMobileQcCnt);
      out[kw] = { pc, mobile, total: pc === null && mobile === null ? null : (pc || 0) + (mobile || 0), comp: hit.compIdx || null };
    }
  }
  return out;
}

module.exports = { getKeywordVolumes, creds, sign, headers, num };
