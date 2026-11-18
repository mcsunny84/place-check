'use strict';
// 병원 점검 라우트: 주소(Host) 분리, 한도, 합류, 상담 접수. 네트워크 0(가짜 점검·가짜 fetch).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const TMP = path.join(os.tmpdir(), 'place-check-hospital-test');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'cache'), { recursive: true });
process.env.PLACE_CACHE_DIR = path.join(TMP, 'cache');
process.env.PLACE_STATS_FILE = path.join(TMP, 'cache', 'coupons.jsonl');
process.env.HOSPITAL_DATA_DIR = path.join(TMP, 'hospital');
process.env.HOSPITAL_HOSTS = 'geo.test';
process.env.ADMIN_TOKEN = 'adm';
const srv = require('../server');
const { runAudit } = require('../lib/hospital/audit');
const H = srv.hospital;

const HOME = '<html><head><title>라온피부과의원</title></head><body><p>진료시간 평일 10:00 ~ 19:00</p><p>전화 02-555-0100</p></body></html>';
const fakeFetcher = async (url) => (url.endsWith('/')
  ? { ok: true, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(HOME), finalUrl: url, ms: 300 }
  : { ok: true, status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.from('x'), finalUrl: url, ms: 10 });
let audits = 0;
H._state.audit = async (u) => { audits++; await new Promise((r) => setTimeout(r, 20)); return runAudit(u, { fetcher: fakeFetcher }); };

let server, port, clock = 1_800_000_000_000;
srv.state.now = () => clock;
srv.state.lastFetchStart = 0;
test.before(async () => { server = srv.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r)); port = server.address().port; });
test.after(() => server.close());

function call(method, p, { host = 'geo.test', body, xff } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { host };
    if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (xff) headers['x-forwarded-for'] = xff;
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(t); } catch { /* 글자 */ } resolve({ status: res.statusCode, text: t, json, headers: res.headers }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('병원 주소에서는 병원 화면만, 플레이스 체크 경로는 없다', async () => {
  const a = await call('GET', '/');
  assert.equal(a.status, 200); assert.match(a.text, /AI 검색 점검/);
  assert.equal((await call('GET', '/privacy')).status, 200);
  assert.equal((await call('GET', '/persona')).status, 404);
  assert.equal((await call('GET', '/lib/copy.js')).status, 404);
  assert.equal((await call('POST', '/api/check', { body: { url: 'x' } })).status, 404);
  assert.equal((await call('GET', '/api/stats/leads?token=adm')).status, 404);
  assert.equal((await call('GET', '/..%2f..%2fserver.js')).status, 404);
  assert.equal((await call('GET', '/../server.js')).status, 404);
});

test('다른 주소에서는 병원 경로가 없다(운영 주소가 설정된 동안은 localhost도)', async () => {
  for (const host of ['placecheck.test', 'localhost']) {
    assert.equal((await call('POST', '/api/hospital/check', { host, body: { url: 'raon.example' } })).status, 404);
    assert.equal((await call('GET', '/hospital/', { host })).status, 404);
    assert.equal((await call('GET', '/api/hospital/stats?token=adm', { host })).status, 404);
  }
  const pc = await call('GET', '/', { host: 'placecheck.test' });
  assert.equal(pc.status, 200); assert.doesNotMatch(pc.text, /병원 홈페이지 AI 검색 점검/);
});

test('운영 주소가 없을 때만 localhost /hospital/ 로 연다', async () => {
  const keep = process.env.HOSPITAL_HOSTS; process.env.HOSPITAL_HOSTS = '';
  try {
    assert.equal((await call('GET', '/hospital/', { host: 'localhost:8090' })).status, 200);
    assert.equal((await call('GET', '/hospital/', { host: 'placecheck.test' })).status, 404);
  } finally { process.env.HOSPITAL_HOSTS = keep; }
});

test('점검: 결과·공유 링크, 같은 주소 동시 요청은 한 번만 점검, 1시간 보관', async () => {
  audits = 0;
  const [a, b] = await Promise.all([call('POST', '/api/hospital/check', { body: { url: 'raon.example' } }), call('POST', '/api/hospital/check', { body: { url: 'https://www.raon.example/' } })]);
  assert.equal(a.json.ok, true); assert.equal(b.json.ok, true);
  assert.equal(audits, 1, '합류');
  const r = a.json.result;
  assert.equal(r.host, 'raon.example'); assert.equal(typeof r.score, 'number');
  assert.equal(r.items.reduce((n, x) => n + x.max, 0), 100);
  assert.equal(r.score + r.ladder.reduce((n, x) => n + x.gain, 0), r.after);
  assert.deepEqual(Object.keys(r.doors), ['chatgpt', 'claude', 'gemini', 'perplexity']);
  await call('POST', '/api/hospital/check', { body: { url: 'raon.example' } });
  assert.equal(audits, 1, '보관분 사용');
  const snap = await call('GET', '/api/hospital/report/' + r.token);
  assert.equal(snap.json.result.score, r.score);
  assert.equal((await call('GET', '/api/hospital/report/../../x')).status, 404);
  clock += 61 * 60 * 1000;
  await call('POST', '/api/hospital/check', { body: { url: 'raon.example' } });
  assert.equal(audits, 2, '1시간 뒤 다시 점검');
});

test('점검: 말이 안 되는 주소, 큰 본문, 깨진 JSON', async () => {
  assert.deepEqual((await call('POST', '/api/hospital/check', { body: { url: '라온피부과' } })).json, { ok: false, reason: 'bad_url' });
  assert.equal((await call('POST', '/api/hospital/check', { body: '{깨짐' })).status, 400);
  await assert.rejects(call('POST', '/api/hospital/check', { body: { url: 'a'.repeat(6000) } }));
});

test('점검 한도: 1분에 6곳, 위조한 전달 주소로는 못 피한다', async () => {
  clock += 5 * 60 * 1000; H._state.ipLog.check.clear();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await call('POST', '/api/hospital/check', { body: { url: `limit${i}.example` } })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429, 429]);
  // 테스트 접속은 loopback 이라 프록시로 취급된다 → 전달 주소가 다르면 다른 사람
  assert.equal((await call('POST', '/api/hospital/check', { body: { url: 'limit9.example' }, xff: '203.0.113.9' })).status, 200);
  // 직접 접속(loopback 아님)은 헤더를 무시한다
  assert.equal(srv.clientIp({ socket: { remoteAddress: '198.51.100.7' }, headers: { 'x-forwarded-for': '1.1.1.1' } }), '198.51.100.7');
});

test('이름 검색: 이름이 맞는 병원을 위로, 고르면 홈페이지 주소(SNS 제외)', async () => {
  const apollo = (o) => `<html><script>window.__APOLLO_STATE__ = ${JSON.stringify(o)};</script></html>`;
  const list = apollo({ ROOT_QUERY: { 'hospitals({})': { businesses: { items: [{ __ref: 'H:1' }, { __ref: 'H:2' }, { __ref: 'H:3' }] } } }, 'H:1': { id: '1', name: '광고피부과', category: '피부과' }, 'H:2': { id: '2', name: '라온피부과의원', category: '피부과', roadAddress: '강남대로 396' }, 'H:3': { id: '3', name: '라온 피부과', category: '피부과' } });
  let homeHtml = '';
  srv.state.fetchImpl = async (url) => ({ status: 200, url, text: async () => (url.includes('/list?') ? list : homeHtml) });
  const s = await call('POST', '/api/hospital/search', { body: { q: '라온피부과' } });
  assert.equal(s.json.ok, true);
  assert.deepEqual(s.json.items.map((x) => x.id), ['3', '2', '1']);
  assert.deepEqual((await call('POST', '/api/hospital/search', { body: { q: '라' } })).json, { ok: false, reason: 'too_short' });

  const P = require('../lib/place-parse');
  const real = P.parseHome;
  try {
    P.parseHome = () => ({ name: { status: 'value', value: '라온피부과의원' }, homepages: { status: 'value', value: ['https://blog.naver.com/raon', 'http://www.raon.example', 'https://instagram.com/raon'] } });
    assert.deepEqual((await call('POST', '/api/hospital/pick', { body: { id: '2' } })).json, { ok: true, name: '라온피부과의원', url: 'http://www.raon.example/' });
    P.parseHome = () => ({ name: { status: 'value', value: '라온피부과의원' }, homepages: { status: 'value', value: ['https://blog.naver.com/raon'] } });
    assert.deepEqual((await call('POST', '/api/hospital/pick', { body: { id: '2' } })).json, { ok: false, reason: 'no_homepage', name: '라온피부과의원', sns: true });
    assert.equal((await call('POST', '/api/hospital/pick', { body: { id: 'abc' } })).json.reason, 'bad_request');
  } finally { P.parseHome = real; }
});

test('전화 상담 신청: 동의·연락처 필수, 관리자만 열람, 1년 지나면 삭제', async () => {
  const token = (await call('POST', '/api/hospital/check', { body: { url: 'raon.example' }, xff: '203.0.113.50' })).json.result.token;
  assert.equal((await call('POST', '/api/hospital/lead', { body: { hospital: '라온피부과', phone: '010-1234-5678', time: '오후 2시 이후' } })).json.reason, 'consent');
  assert.equal((await call('POST', '/api/hospital/lead', { body: { hospital: '라온피부과', phone: '123', consent: true } })).json.reason, 'invalid');
  assert.equal((await call('POST', '/api/hospital/lead', { body: { hospital: '', phone: '01012345678', consent: true } })).json.reason, 'invalid');
  const ok = await call('POST', '/api/hospital/lead', { body: { hospital: '라온피부과', phone: '010-1234-5678', time: '오후 2시 이후', consent: true, token } });
  assert.deepEqual(ok.json, { ok: true });
  assert.equal((await call('GET', '/api/hospital/stats')).status, 404);
  assert.equal((await call('GET', '/api/hospital/stats?token=wrong')).status, 404);
  const st = (await call('GET', '/api/hospital/stats?token=adm')).json;
  assert.equal(st.leads, 1);
  assert.deepEqual([st.recentLeads[0].hospital, st.recentLeads[0].phone, st.recentLeads[0].time, st.recentLeads[0].host], ['라온피부과', '01012345678', '오후 2시 이후', 'raon.example']);
  assert.equal(typeof st.recentLeads[0].score, 'number');
  assert.ok(st.checks >= 1);
  // 플레이스 체크 상담 파일과 섞이지 않는다
  assert.equal(fs.existsSync(path.join(TMP, 'cache', 'leads.jsonl')), false);
  clock += 366 * 24 * 3600 * 1000;
  assert.equal((await call('GET', '/api/hospital/stats?token=adm')).json.leads, 0);
});

test('상담 신청 한도: 1분에 5건', async () => {
  H._state.ipLog.lead.clear();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await call('POST', '/api/hospital/lead', { body: { hospital: '가', phone: '01000000000', consent: true }, xff: '203.0.113.77' })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});
