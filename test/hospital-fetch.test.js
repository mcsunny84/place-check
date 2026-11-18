'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { safeFetch } = require('../lib/hospital/safe-fetch');

function serve(handler) {
  return new Promise((resolve) => {
    const sockets = new Set();
    const srv = http.createServer(handler);
    srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, sockets, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => { for (const s of sockets) s.destroy(); srv.close(r); }) }));
  });
}
const T = { _allowLoopbackForTest: true };

test('정상 응답은 Buffer 본문과 최종 주소를 준다', async () => {
  const s = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>hi</p>'); });
  const r = await safeFetch(s.url + '/', T);
  assert.equal(r.ok, true); assert.equal(r.status, 200);
  assert.ok(Buffer.isBuffer(r.body)); assert.equal(r.body.toString(), '<p>hi</p>');
  assert.equal(r.finalUrl, s.url + '/');
  await s.close();
});

test('내부 주소·비표준 포트·비 http는 거절', async () => {
  assert.equal((await safeFetch('http://127.0.0.1/')).unavailable_reason, 'address_rejected');
  assert.equal((await safeFetch('http://10.0.0.5/')).unavailable_reason, 'address_rejected');
  assert.equal((await safeFetch('http://[::1]/')).unavailable_reason, 'address_rejected');
  assert.equal((await safeFetch('http://169.254.169.254/latest/meta-data')).unavailable_reason, 'address_rejected');
  assert.equal((await safeFetch('http://example.com:8080/')).unavailable_reason, 'port_rejected');
  assert.equal((await safeFetch('ftp://example.com/')).unavailable_reason, 'scheme_rejected');
  assert.equal((await safeFetch('file:///etc/passwd')).unavailable_reason, 'scheme_rejected');
  assert.equal((await safeFetch('http://user:pw@example.com/')).unavailable_reason, 'bad_url');
  assert.equal((await safeFetch('not a url')).unavailable_reason, 'bad_url');
});

test('이름이 내부 주소로 풀리면 거절(하나라도 내부면)', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }, { address: '192.168.0.10', family: 4 }];
  assert.equal((await safeFetch('http://evil.test/', { _lookup: lookup })).unavailable_reason, 'address_rejected');
});

test('이동한 곳이 내부 주소면 거절', async () => {
  const s = await serve((req, res) => { res.writeHead(302, { location: 'http://10.1.2.3/secret' }); res.end(); });
  const r = await safeFetch(s.url + '/', T);
  assert.equal(r.ok, false); assert.equal(r.unavailable_reason, 'address_rejected');
  await s.close();
});

test('끝없는 이동은 횟수에서 끊는다', async () => {
  const s = await serve((req, res) => { res.writeHead(302, { location: '/again' }); res.end(); });
  const r = await safeFetch(s.url + '/', T);
  assert.equal(r.unavailable_reason, 'too_many_redirects');
  await s.close();
});

test('헤더를 늦게 주는 서버는 마감에서 끝나고 연결이 닫힌다', async () => {
  const s = await serve(() => { /* 응답하지 않음 */ });
  const t0 = Date.now();
  const r = await safeFetch(s.url + '/', { ...T, totalTimeoutMs: 150 });
  assert.equal(r.unavailable_reason, 'timeout');
  assert.ok(Date.now() - t0 < 600, '마감을 크게 넘기지 않는다');
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(s.sockets.size, 0, '연결이 남아 있지 않다');
  await s.close();
});

test('본문을 조금씩 흘리는 서버도 절대 마감에서 끝난다', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const iv = setInterval(() => res.write('x'), 20);
    res.on('close', () => clearInterval(iv));
  });
  const t0 = Date.now();
  const r = await safeFetch(s.url + '/', { ...T, totalTimeoutMs: 200 });
  assert.equal(r.unavailable_reason, 'timeout');
  assert.ok(Date.now() - t0 < 700);
  await new Promise((r2) => setTimeout(r2, 50));
  assert.equal(s.sockets.size, 0);
  await s.close();
});

test('DNS가 늦어도 마감에서 끝난다', async () => {
  const lookup = () => new Promise((resolve) => setTimeout(() => resolve([{ address: '93.184.216.34', family: 4 }]), 2000).unref());
  const t0 = Date.now();
  const r = await safeFetch('http://slow-dns.test/', { _lookup: lookup, totalTimeoutMs: 100 });
  assert.equal(r.unavailable_reason, 'timeout');
  assert.ok(Date.now() - t0 < 500);
});

test('한도를 넘는 본문은 끊고, 허용하지 않는 종류는 받지 않는다', async () => {
  let sent = 0;
  const s = await serve((req, res) => {
    if (req.url === '/img') { res.writeHead(200, { 'content-type': 'image/png' }); const iv = setInterval(() => { sent += 1024; res.write(Buffer.alloc(1024)); }, 5); res.on('close', () => clearInterval(iv)); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(Buffer.alloc(5000, 97));
  });
  const big = await safeFetch(s.url + '/', { ...T, maxBodyBytes: 1000 });
  assert.equal(big.unavailable_reason, 'too_large');
  const img = await safeFetch(s.url + '/img', T);
  assert.equal(img.unavailable_reason, 'content_type_rejected');
  const at = sent; await new Promise((r2) => setTimeout(r2, 80));
  assert.ok(sent - at <= 2048, '거절한 뒤에는 더 받지 않는다');
  assert.equal(s.sockets.size, 0);
  await s.close();
});

test('truncate: 아주 큰 본문은 앞부분만 읽고 성공으로 돌려준다', async () => {
  const s = await serve((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<p>' + 'a'.repeat(5000) + '</p>'); });
  const r = await safeFetch(s.url + '/', { ...T, maxBodyBytes: 1000, truncate: true });
  assert.equal(r.ok, true); assert.equal(r.truncated, true); assert.equal(r.body.length, 1000);
  await s.close();
});
