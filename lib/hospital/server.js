'use strict';
// 「병원 홈페이지 AI 검색 점검」 — 플레이스 체크와 같은 프로세스에서 돌지만 주소(Host)로 완전히 나눈다.
// 병원 주소로 온 요청은 hospital-public 과 /api/hospital/* 만 본다. 다른 주소에서는 병원 경로가 없는 것처럼(404) 보인다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { runAudit, normalizeInput } = require('./audit');
const { scoreAudit, readList } = require('./score');
const RK = require('../rank-check');
const P = require('../place-parse');

const PUBLIC = path.join(__dirname, '..', '..', 'hospital-public');
const CACHE_TTL_MS = 60 * 60 * 1000, FAIL_TTL_MS = 2 * 60 * 1000, CACHE_MAX = 500;
const SLOTS = 2, WAIT_MAX = 10;
const CHECK_IP_LIMIT = 6, SEARCH_IP_LIMIT = 10, LEAD_IP_LIMIT = 5;
const LEAD_KEEP_MS = 365 * 24 * 3600 * 1000;
const REPORT_KEEP_MS = 90 * 24 * 3600 * 1000, REPORT_MAX_FILES = 5000, EVENTS_MAX_BYTES = 20 * 1024 * 1024;
const JOIN_MAX = 20, NAVER_WAIT_MAX = 10, SWEEP_EVERY_MS = 60 * 60 * 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NOT_HOMEPAGE = /(^|\.)(blog\.naver\.com|m\.blog\.naver\.com|cafe\.naver\.com|booking\.naver\.com|m\.booking\.naver\.com|talk\.naver\.com|smartstore\.naver\.com|map\.naver\.com|naver\.me|instagram\.com|facebook\.com|youtube\.com|youtu\.be|pf\.kakao\.com|open\.kakao\.com|x\.com|twitter\.com|tiktok\.com|linktr\.ee|litt\.ly)$/i;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

// 주소 비교용: 소문자, 포트 제거, 끝의 점 제거(geo.example. 과 geo.example 은 같은 곳)
const canonHost = (h) => String(h || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
function hostOf(req) { return canonHost(req.headers.host); }
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
// 한도 계산용 접속 주소. 같은 기계의 프록시를 거쳤을 때만 전달 헤더를 보고, 그중 맨 뒤 값(우리 프록시가 붙인 값)만 믿는다.
// 앞쪽 값은 방문자가 마음대로 적어 보낼 수 있다.
function ipOf(req) {
  const ra = (req.socket && req.socket.remoteAddress) || '';
  if (!LOOPBACK.has(ra)) return ra;
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : ra;
}

function publicResult(a, s, token) {
  const door = (d) => ({ label: d.label, state: d.state, training: d.training });
  return {
    host: a.host, checked_at: a.checked_at, token,
    score: s.score, grade: s.grade, capped: s.capped, after: s.after,
    doors: { chatgpt: door(a.doors.chatgpt), claude: door(a.doors.claude), gemini: door(a.doors.gemini), perplexity: door(a.doors.perplexity) },
    robots: a.robots.state,
    critical: s.critical, trainingOff: s.trainingOff,
    items: s.items, ladder: s.ladder,
    read: { chars: a.text.chars, lines: a.text.lines.slice(0, 14), images: a.text.images, list: readList(a), title: a.hygiene.titleText },
  };
}

function create(deps) {
  const { send, adminOk, fetchText, isBlocked, inCooldown, startCooldown } = deps;
  const clientIp = ipOf;
  const now = deps.now || (() => Date.now());
  const dataDir = deps.dataDir;
  const LEADS = path.join(dataDir, 'hospital-leads.jsonl');
  const EVENTS = path.join(dataDir, 'hospital-checks.jsonl');
  const REPORTS = path.join(dataDir, 'hospital-reports');
  const hosts = () => new Set(String(process.env.HOSPITAL_HOSTS || '').split(',').map(canonHost).filter(Boolean));
  const st = { cache: new Map(), jobs: new Map(), running: 0, waiters: [], ipLog: { check: new Map(), search: new Map(), lead: new Map() }, searchCache: new Map(), searchJobs: new Map(), naverWaiting: 0, naverTail: Promise.resolve(), saves: 0, audit: deps.audit || runAudit };

  // 네이버로 나가는 요청(이름 검색·병원 선택)은 한 줄로 세운다. 줄이 길면 null(=지금은 바쁨).
  function naver(fn) {
    if (st.naverWaiting >= NAVER_WAIT_MAX) return null;
    st.naverWaiting += 1;
    const run = st.naverTail.then(fn, fn);
    st.naverTail = run.catch(() => {});
    return run.finally(() => { st.naverWaiting -= 1; });
  }

  function ipAllowed(log, ip, limit) {
    const t = now(); const arr = (log.get(ip) || []).filter((x) => t - x < 60_000);
    log.set(ip, arr);
    if (log.size > 1000) for (const [k, a] of log) if (!a.some((x) => t - x < 60_000)) log.delete(k);
    if (arr.length >= limit) return false;
    arr.push(t); return true;
  }
  async function withSlot(fn) {
    if (st.running >= SLOTS) {
      if (st.waiters.length >= WAIT_MAX) return null;
      await new Promise((r) => st.waiters.push(r));
    } else st.running += 1;
    try { return await fn(); } finally { const next = st.waiters.shift(); if (next) next(); else st.running -= 1; }
  }
  const append = (file, obj) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + '\n'); return true; } catch { return false; } };
  // 점검 기록은 통계용이라 파일이 한도를 넘으면 더 쌓지 않는다
  const logEvent = (obj) => { try { if (fs.statSync(EVENTS).size > EVENTS_MAX_BYTES) return; } catch { /* 아직 없음 */ } append(EVENTS, obj); };
  const readLines = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  function saveReport(result) {
    try { fs.mkdirSync(REPORTS, { recursive: true }); fs.writeFileSync(path.join(REPORTS, result.token + '.json'), JSON.stringify(result)); } catch { /* 공유 링크만 안 될 뿐 */ }
    if (++st.saves % 200 === 0) sweep();
  }
  function readReport(token) {
    if (!/^[A-Za-z0-9_-]{8,16}$/.test(token)) return null;
    try { return JSON.parse(fs.readFileSync(path.join(REPORTS, token + '.json'), 'utf8')); } catch { return null; }
  }
  // 보관 기간(1년)이 지난 상담 신청은 지운다
  function pruneLeads() {
    const all = readLines(LEADS); const keep = all.filter((l) => now() - Date.parse(l.ts) < LEAD_KEEP_MS);
    if (keep.length !== all.length) { try { fs.writeFileSync(LEADS, keep.map((l) => JSON.stringify(l)).join('\n') + (keep.length ? '\n' : '')); } catch { /* 다음에 */ } }
    return keep;
  }

  // 보관 기간 청소: 상담 신청 1년, 결과 사본 90일(그리고 최대 5,000개), 한도 계산용 접속 주소 1분. 시작할 때와 1시간마다 돈다.
  function sweep() {
    pruneLeads();
    try {
      const files = fs.readdirSync(REPORTS).filter((f) => f.endsWith('.json')).map((f) => { const full = path.join(REPORTS, f); return { full, m: fs.statSync(full).mtimeMs }; }).sort((x, y) => y.m - x.m);
      files.forEach((f, i) => { if (i >= REPORT_MAX_FILES || now() - f.m > REPORT_KEEP_MS) { try { fs.unlinkSync(f.full); } catch { /* 다음에 */ } } });
    } catch { /* 폴더 없음 */ }
    for (const log of Object.values(st.ipLog)) for (const [k, a] of log) if (!a.some((x) => now() - x < 60_000)) log.delete(k);
    for (const [k, v] of st.cache) if (now() - v.at > CACHE_TTL_MS) st.cache.delete(k);
    for (const [k, v] of st.searchCache) if (now() - v.at > CACHE_TTL_MS) st.searchCache.delete(k);
  }

  async function check(req, res, input) {
    const u = normalizeInput(input.url);
    if (!u) return send(res, 200, { ok: false, reason: 'bad_url' });
    const key = u.protocol + '//' + u.hostname + u.pathname + u.search; // http/https, www 유무는 서로 다른 곳일 수 있어 따로 본다
    const hit = st.cache.get(key);
    if (hit && now() - hit.at < (hit.payload.ok ? CACHE_TTL_MS : FAIL_TTL_MS)) return send(res, 200, hit.payload);
    // 보관분이 없으면, 이미 돌고 있는 점검에 붙는 요청도 한 사람당 한도에 넣는다
    if (!ipAllowed(st.ipLog.check, clientIp(req), CHECK_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'slow_down' });
    let job = st.jobs.get(key);
    if (job && job.subs >= JOIN_MAX) return send(res, 429, { ok: false, reason: 'busy' });
    if (!job) {
      job = withSlot(async () => {
        const a = await st.audit(u.href);
        if (!a.ok) { logEvent({ ts: new Date(now()).toISOString(), host: u.hostname, ok: false, reason: a.reason }); return { ok: false, reason: a.reason === 'blocked' ? 'blocked' : a.reason === 'bad_url' ? 'bad_url' : 'unreachable', detail: a.reason }; }
        const s = scoreAudit(a);
        const result = publicResult(a, s, crypto.randomBytes(8).toString('base64url'));
        saveReport(result);
        logEvent({ ts: new Date(now()).toISOString(), host: a.host, ok: true, score: s.score, grade: s.grade, doors: Object.values(result.doors).map((d) => d.state[0]).join(''), token: result.token });
        return { ok: true, result };
      }).then((payload) => {
        if (payload) { if (st.cache.size >= CACHE_MAX) st.cache.clear(); st.cache.set(key, { at: now(), payload }); }
        return payload || { ok: false, reason: 'busy' };
      }).catch(() => ({ ok: false, reason: 'error' })).finally(() => st.jobs.delete(key));
      job.subs = 0;
      st.jobs.set(key, job);
    }
    job.subs += 1;
    const payload = await job;
    if (!res.writableEnded && !res.destroyed) send(res, 200, payload);
  }

  async function search(req, res, input) {
    const q = typeof input.q === 'string' ? input.q.replace(/\s+/g, ' ').trim() : '';
    if (q.length < 2) return send(res, 200, { ok: false, reason: 'too_short' });
    if (q.length > 40) return send(res, 200, { ok: false, reason: 'too_long' });
    const hit = st.searchCache.get(q);
    if (hit && now() - hit.at < CACHE_TTL_MS) return send(res, 200, { ok: true, items: hit.items });
    if (inCooldown()) return send(res, 200, { ok: false, reason: 'cooldown' });
    if (!ipAllowed(st.ipLog.search, clientIp(req), SEARCH_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'slow_down' });
    let items = null;
    try {
      let job = st.searchJobs.get(q); // 같은 검색어가 동시에 오면 한 번만 나간다
      if (!job) { job = naver(() => fetchText(RK.listUrl('hospital', q))); if (!job) return send(res, 200, { ok: false, reason: 'busy' }); st.searchJobs.set(q, job); job.finally(() => st.searchJobs.delete(q)).catch(() => {}); }
      const r = await job; items = r.status === 200 ? RK.parseSearch(r.text, 20) : null;
    } catch (e) { if (isBlocked(e)) { startCooldown(); return send(res, 200, { ok: false, reason: 'cooldown' }); } }
    if (!items) return send(res, 200, { ok: false, reason: 'unreadable' });
    // 광고·주변 병원이 먼저 나오므로 이름이 맞는 곳을 위로
    const nq = q.replace(/\s/g, '');
    const rank = (it) => { const n = it.name.replace(/\s/g, ''); return n === nq ? 0 : n.includes(nq) ? 1 : nq.includes(n) ? 2 : 3; };
    items = items.map((it, i) => ({ it, i, r: rank(it) })).sort((x, y) => x.r - y.r || x.i - y.i).slice(0, 6).map((x) => ({ id: x.it.id, name: x.it.name, category: x.it.category, address: x.it.address }));
    if (st.searchCache.size >= CACHE_MAX) st.searchCache.clear();
    st.searchCache.set(q, { at: now(), items });
    send(res, 200, { ok: true, items });
  }

  async function pick(req, res, input) {
    const id = /^\d{1,20}$/.test(String(input.id)) ? String(input.id) : null;
    if (!id) return send(res, 200, { ok: false, reason: 'bad_request' });
    if (inCooldown()) return send(res, 200, { ok: false, reason: 'cooldown' });
    if (!ipAllowed(st.ipLog.search, clientIp(req), SEARCH_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'slow_down' });
    let facts = null;
    try {
      const job = naver(() => fetchText(`https://m.place.naver.com/hospital/${id}/home`));
      if (!job) return send(res, 200, { ok: false, reason: 'busy' });
      const r = await job; facts = r.status === 200 ? P.parseHome(r.text) : null;
    }
    catch (e) { if (isBlocked(e)) { startCooldown(); return send(res, 200, { ok: false, reason: 'cooldown' }); } }
    if (!facts) return send(res, 200, { ok: false, reason: 'unreadable' });
    const name = facts.name && facts.name.status === 'value' ? facts.name.value : null;
    const urls = facts.homepages && facts.homepages.status === 'value' ? facts.homepages.value : [];
    const url = urls.map((x) => normalizeInput(x)).filter(Boolean).find((x) => !NOT_HOMEPAGE.test(x.hostname));
    if (!url) return send(res, 200, { ok: false, reason: 'no_homepage', name, sns: urls.length > 0 });
    send(res, 200, { ok: true, name, url: url.href });
  }

  function lead(req, res, input) {
    const hospital = String(input.hospital || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const phone = String(input.phone || '').replace(/[^0-9]/g, '');
    const time = String(input.time || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!hospital || phone.length < 9 || phone.length > 11) return send(res, 400, { ok: false, reason: 'invalid' });
    if (input.consent !== true) return send(res, 400, { ok: false, reason: 'consent' });
    if (!ipAllowed(st.ipLog.lead, clientIp(req), LEAD_IP_LIMIT)) return send(res, 429, { ok: false, reason: 'slow_down' });
    const r = input.token ? readReport(String(input.token)) : null;
    pruneLeads();
    const ok = append(LEADS, { ts: new Date(now()).toISOString(), hospital, phone, time: time || null, host: r ? r.host : null, score: r ? r.score : null, grade: r ? r.grade : null, token: r ? r.token : null });
    send(res, ok ? 200 : 500, { ok });
  }

  function serve(res, rel) {
    const file = path.normalize(path.join(PUBLIC, rel));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 404, 'not found', 'text/plain');
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, 'not found', 'text/plain');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff' });
      res.end(buf);
    });
  }

  function api(req, res, route) {
    if (req.method === 'GET' && route.startsWith('/api/hospital/report/')) {
      const snap = readReport(route.slice('/api/hospital/report/'.length));
      return snap ? send(res, 200, { ok: true, result: snap }) : send(res, 404, { ok: false, reason: 'not_found' });
    }
    if (req.method === 'GET' && route === '/api/hospital/stats') {
      if (!adminOk(req)) return send(res, 404, 'not found', 'text/plain');
      const leads = pruneLeads(); const ev = readLines(EVENTS);
      return send(res, 200, { leads: leads.length, recentLeads: leads.slice(-200).reverse(), checks: ev.length, checksOk: ev.filter((e) => e.ok).length, recentChecks: ev.slice(-200).reverse() });
    }
    if (req.method !== 'POST') return send(res, 404, { ok: false, reason: 'not_found' });
    const fn = { '/api/hospital/check': check, '/api/hospital/search': search, '/api/hospital/pick': pick, '/api/hospital/lead': lead }[route];
    if (!fn) return send(res, 404, { ok: false, reason: 'not_found' });
    let body = '', dead = false;
    req.on('data', (c) => { body += c; if (body.length > 4096) { dead = true; req.destroy(); } });
    req.on('end', () => {
      if (dead) return;
      let input; try { input = JSON.parse(body || '{}'); } catch { return send(res, 400, { ok: false, reason: 'bad_request' }); }
      if (!input || typeof input !== 'object') return send(res, 400, { ok: false, reason: 'bad_request' });
      Promise.resolve().then(() => fn(req, res, input)).catch(() => { if (!res.headersSent) send(res, 500, { ok: false, reason: 'error' }); });
    });
  }

  // true를 돌려주면 이 요청은 여기서 끝났다는 뜻
  function handle(req, res) {
    const host = hostOf(req); const set = hosts();
    const route = req.url.split('?')[0];
    const isHospitalPath = route === '/hospital' || route.startsWith('/hospital/') || route.startsWith('/api/hospital/');
    if (set.has(host)) {
      if (route.startsWith('/api/hospital/')) { api(req, res, route); return true; }
      if (req.method !== 'GET') { send(res, 404, 'not found', 'text/plain'); return true; }
      if (route === '/' || route.startsWith('/r/')) { serve(res, 'index.html'); return true; }
      if (route === '/privacy') { serve(res, 'privacy.html'); return true; }
      if (route.startsWith('/api/') || route.startsWith('/lib/')) { send(res, 404, 'not found', 'text/plain'); return true; } // 플레이스 체크 쪽은 이 주소에 없다
      serve(res, route.slice(1)); return true;
    }
    if (!isHospitalPath) return false;
    // 병원 주소가 아닌 곳: 개발용 localhost(운영 주소 미설정)에서만 /hospital 아래로 연다
    if (!(set.size === 0 && LOCAL_HOSTS.has(host))) { send(res, 404, 'not found', 'text/plain'); return true; }
    if (route.startsWith('/api/hospital/')) { api(req, res, route); return true; }
    if (req.method !== 'GET') { send(res, 404, 'not found', 'text/plain'); return true; }
    if (route === '/hospital') { res.writeHead(302, { location: '/hospital/' }); res.end(); return true; }
    const rel = route.slice('/hospital/'.length);
    if (rel === '' || rel.startsWith('r/')) { serve(res, 'index.html'); return true; }
    if (rel === 'privacy') { serve(res, 'privacy.html'); return true; }
    serve(res, rel); return true;
  }

  sweep();
  const timer = setInterval(sweep, SWEEP_EVERY_MS); if (timer.unref) timer.unref();

  return { handle, sweep, _state: st, _files: { LEADS, EVENTS, REPORTS } };
}

module.exports = { create, publicResult, NOT_HOMEPAGE };
