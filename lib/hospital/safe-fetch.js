'use strict';
// 남의 홈페이지를 서버가 대신 가져오는 통로. 지키는 것:
//  - http/https, 80/443만. 주소가 가리키는 IP가 전부 공인 주소여야 하고, 검사한 그 IP로 직접 연결(이름 재해석 없음).
//  - 이동(3xx)마다 같은 검사를 다시 한다.
//  - 절대 마감 하나가 DNS·연결·헤더·본문·이동 전체를 덮는다. 마감·한도 초과·버리는 응답은 즉시 연결을 끊는다.
// 본문은 Buffer로 돌려준다(글자 해독은 html.js가 인코딩을 보고 한다).
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { isPublicUnicastIp, normalizeIpLiteral } = require('./ip-policy');

const ALLOWED_CONTENT = /^(text\/|application\/(xml|json|ld\+json|xhtml\+xml|rss\+xml|atom\+xml))/i;
const UA = 'Mozilla/5.0 (compatible; EastlightHospitalCheck/1.0; +https://eastlightlabs.kr)';

function fail(reason, extra) { return { ok: false, unavailable_reason: reason, ...(extra || {}) }; }

// 마감까지 남은 시간 안에 promise가 끝나지 않으면 'timeout'으로 끝낸다.
function withDeadline(promise, deadline) {
  const left = deadline - Date.now();
  if (left <= 0) return Promise.resolve({ __timeout: true });
  let timer;
  const t = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timeout: true }), left); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

async function safeFetch(rawUrl, opts = {}) {
  const {
    maxBodyBytes = 1500 * 1024, truncate = false, totalTimeoutMs = 8000, maxRedirects = 4, userAgent = UA,
    _lookup, _allowLoopbackForTest = false,
  } = opts;
  const lookup = _lookup || ((host) => dns.promises.lookup(host, { all: true, verbatim: true }));
  const started = Date.now();
  const deadline = started + totalTimeoutMs;
  const policy = (ip) => isPublicUnicastIp(ip) || (_allowLoopbackForTest && (ip === '127.0.0.1' || ip === '::1'));

  let url;
  try { url = new URL(String(rawUrl)); } catch { return fail('bad_url'); }
  let redirects = 0;

  for (;;) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme_rejected');
    if (url.username || url.password) return fail('bad_url');
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const port = url.port ? Number(url.port) : defaultPort;
    if (!_allowLoopbackForTest && port !== 80 && port !== 443) return fail('port_rejected');

    let address;
    const literal = normalizeIpLiteral(url.hostname);
    if (literal) {
      if (!policy(literal)) return fail('address_rejected');
      address = literal;
    } else {
      const looked = await withDeadline(Promise.resolve().then(() => lookup(url.hostname)).catch(() => null), deadline);
      if (looked && looked.__timeout) return fail('timeout');
      if (!Array.isArray(looked) || looked.length === 0) return fail('dns_failed');
      if (!looked.every((r) => policy(r.address))) return fail('address_rejected');
      address = looked[0].address;
    }

    if (deadline - Date.now() <= 0) return fail('timeout');
    const mod = url.protocol === 'https:' ? https : http;
    const out = await new Promise((resolve) => {
      let done = false, req = null, res = null, timer = null;
      const finish = (v) => {
        if (done) return; done = true;
        clearTimeout(timer);
        // 어떤 길로 끝나든 연결을 붙잡고 있지 않는다
        if (res) res.destroy();
        if (req) req.destroy();
        resolve(v);
      };
      timer = setTimeout(() => finish(fail('timeout')), Math.max(1, deadline - Date.now()));
      req = mod.request({
        host: address, servername: literal ? undefined : url.hostname, port,
        path: url.pathname + url.search, method: 'GET', agent: false,
        headers: { host: url.host, 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5', 'accept-language': 'ko,en;q=0.8', 'accept-encoding': 'identity' },
      }, (r) => {
        res = r;
        const status = r.statusCode || 0;
        if (status >= 300 && status < 400 && r.headers.location) return finish({ redirect: r.headers.location });
        const ct = String(r.headers['content-type'] || '');
        if (ct && !ALLOWED_CONTENT.test(ct)) return finish(fail('content_type_rejected', { status }));
        const chunks = []; let size = 0;
        r.on('data', (c) => {
          size += c.length;
          if (size > maxBodyBytes) {
            if (!truncate) return finish(fail('too_large', { status }));
            // 아주 큰 화면은 앞부분만 읽고 끝낸다(연결은 finish가 끊는다)
            chunks.push(c.subarray(0, c.length - (size - maxBodyBytes)));
            return finish({ ok: true, status, headers: r.headers, body: Buffer.concat(chunks), finalUrl: url.href, ms: Date.now() - started, truncated: true });
          }
          chunks.push(c);
        });
        r.on('end', () => finish({ ok: true, status, headers: r.headers, body: Buffer.concat(chunks), finalUrl: url.href, ms: Date.now() - started }));
        r.on('error', () => finish(fail('network_error')));
        r.on('aborted', () => finish(fail('network_error')));
      });
      req.on('error', () => finish(fail('network_error')));
      req.end();
    });

    if (out.redirect) {
      if (++redirects > maxRedirects) return fail('too_many_redirects');
      try { url = new URL(out.redirect, url); } catch { return fail('bad_redirect'); }
      continue;
    }
    return out;
  }
}

module.exports = { safeFetch, UA };
