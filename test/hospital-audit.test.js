'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { runAudit, normalizeInput } = require('../lib/hospital/audit');
const { scoreAudit, readList } = require('../lib/hospital/score');

// 가짜 가져오기: 주소 → 응답
function fake(map, log = []) {
  return async (url) => {
    log.push(url);
    const hit = map[url];
    if (!hit) return { ok: true, status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html><body>없음</body></html>'), finalUrl: url, ms: 50 };
    if (hit.fail) return { ok: false, unavailable_reason: hit.fail };
    return { ok: true, status: hit.status || 200, headers: Object.assign({ 'content-type': hit.type || 'text/html; charset=utf-8' }, hit.headers || {}), body: Buffer.from(hit.body || ''), finalUrl: hit.finalUrl || url, ms: hit.ms || 400 };
  };
}

const IMAGE_ONLY = '<html><head><title>Home</title></head><body><img src="main1.jpg"><img src="main2.jpg"><img src="main3.jpg"><a href="/doctor.php">의료진</a></body></html>';

const GOOD_HOME = `<html lang="ko"><head><title>라온피부과의원 | 강남역 피부과</title>
<meta name="description" content="강남역 3번 출구 라온피부과의원. 여드름, 기미, 리프팅 진료 안내와 진료시간을 확인하세요.">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="https://raon.example/">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"MedicalClinic","name":"라온피부과의원","telephone":"02-555-0100","address":{"@type":"PostalAddress","streetAddress":"서울 강남구 강남대로 396"},"openingHours":"Mo-Fr 10:00-19:00","sameAs":["https://naver.me/raon"],"employee":{"@type":"Person","name":"김라온"}}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}</script></head>
<body><h1>라온피부과의원</h1><p>${'여드름 흉터와 기미를 피부과 전문의가 직접 진료합니다 '.repeat(70)}</p>
<p>서울 강남구 강남대로 396 3층</p><p>전화 02-555-0100</p><p>진료시간 평일 10:00 ~ 19:00, 토요일 10:00 ~ 14:00</p>
<a href="/doctor">의료진 소개</a><a href="/faq">자주 묻는 질문</a>
<img src="a.jpg" alt="진료실 사진"><img src="b.jpg" alt="대기실 사진"></body></html>`;
const GOOD_DOCTOR = `<html><body><h1>의료진</h1><p>김라온 대표원장 피부과 전문의</p><p>${'서울대학교 의과대학 졸업, 대학병원 피부과 전임의, 대한피부과학회 정회원. '.repeat(6)}</p></body></html>`;
const GOOD_FAQ = '<html><body><h1>자주 묻는 질문</h1><ul><li>시술 뒤 세안은 언제부터 되나요?</li><li>주차가 가능한가요?</li><li>예약 없이 방문해도 되나요?</li><li>토요일도 진료하나요?</li><li>시술 시간은 얼마나 걸리나요?</li></ul></body></html>';
const sitemap = (n) => '<?xml version="1.0"?><urlset>' + Array.from({ length: n }, (_, i) => `<url><loc>https://raon.example/p${i}</loc></url>`).join('') + '</urlset>';

test('주소 다듬기: 도메인만 써도 되고, 말이 안 되는 입력은 거절', () => {
  assert.equal(normalizeInput('raon.example').href, 'https://raon.example/');
  assert.equal(normalizeInput(' http://raon.example/a#x ').href, 'http://raon.example/a');
  assert.equal(normalizeInput('라온피부과'), null);
  assert.equal(normalizeInput(''), null);
});

test('이미지뿐인 홈페이지 + AI 검색 로봇 차단 → 낮은 점수, 사다리가 100점까지 설명', async () => {
  const a = await runAudit('bad.example', { fetcher: fake({
    'https://bad.example/': { body: IMAGE_ONLY },
    'https://bad.example/robots.txt': { type: 'text/plain', body: 'User-agent: OAI-SearchBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\n' },
    'https://bad.example/doctor.php': { body: '<html><body><img src="doc.jpg"></body></html>' },
  }) });
  assert.equal(a.ok, true);
  assert.equal(a.doors.chatgpt.state, 'shut'); assert.equal(a.doors.claude.state, 'open');
  assert.equal(a.text.chars < 10, true);
  const s = scoreAudit(a);
  assert.ok(s.score <= 25, `점수 ${s.score}`);
  assert.equal(s.grade, 'D');
  assert.equal(s.items.reduce((n, x) => n + x.max, 0), 100, '만점 합은 100');
  assert.equal(s.score + s.ladder.reduce((n, x) => n + x.gain, 0), 100, '사다리를 다 오르면 100점');
  assert.equal(s.ladder[0].gain >= s.ladder[1].gain, true, '많이 오르는 것부터');
  assert.ok(s.ladder.every((l) => l.title && l.how && l.need));
  assert.equal(readList(a).filter((x) => x.state === 'no').length >= 5, true);
});

test('잘 만든 홈페이지 → 높은 점수, 문 4개 열림', async () => {
  const log = [];
  const a = await runAudit('https://raon.example', { fetcher: fake({
    'https://raon.example/': { body: GOOD_HOME, ms: 500 },
    'https://raon.example/robots.txt': { type: 'text/plain', body: 'User-agent: *\nAllow: /\nSitemap: https://raon.example/sitemap.xml\n' },
    'https://raon.example/sitemap.xml': { type: 'application/xml', body: sitemap(60) },
    'https://raon.example/doctor': { body: GOOD_DOCTOR },
    'https://raon.example/faq': { body: GOOD_FAQ },
  }, log) });
  assert.deepEqual(['chatgpt', 'claude', 'gemini', 'perplexity'].map((k) => a.doors[k].state), ['open', 'open', 'open', 'open']);
  assert.equal(a.structured.medical, true); assert.equal(a.doctors.verified, true);
  assert.equal(a.faq.questions, 5); assert.equal(a.pages.count, 60);
  assert.equal(a.structured.person, true); assert.equal(a.structured.sameAs, true);
  assert.deepEqual(a.basic, { phone: true, address: true, hours: true });
  const s = scoreAudit(a);
  assert.ok(s.score >= 90, `점수 ${s.score}`);
  assert.equal(s.grade, 'A');
  assert.ok(log.length <= 10, `요청 ${log.length}번`);
});

test('robots.txt를 확인 못 하면 문은 확인 못 함, 0점이지만 고칠 항목으로 부르지 않는다', async () => {
  const a = await runAudit('raon.example', { fetcher: fake({
    'https://raon.example/': { body: GOOD_HOME },
    'https://raon.example/robots.txt': { status: 503, body: '' },
  }) });
  assert.equal(a.doors.chatgpt.state, 'unknown');
  const s = scoreAudit(a);
  const ai = s.items.find((x) => x.id === 'ai');
  assert.equal(ai.got, 0); assert.equal(ai.state, 'unknown');
  assert.equal(s.ladder.some((l) => l.id === 'ai'), false);
});

test('첫 화면이 막히면(403·보안 문자) 점수를 내지 않는다', async () => {
  const a = await runAudit('wall.example', { fetcher: fake({ 'https://wall.example/': { status: 403, body: 'Forbidden' } }) });
  assert.deepEqual([a.ok, a.reason], [false, 'blocked']);
  const b = await runAudit('cap.example', { fetcher: fake({ 'https://cap.example/': { body: '<html><body>Just a moment... captcha</body></html>' } }) });
  assert.equal(b.ok, false);
  const c = await runAudit('down.example', { fetcher: fake({ 'https://down.example/': { fail: 'dns_failed' }, 'http://down.example/': { fail: 'dns_failed' } }) });
  assert.deepEqual([c.ok, c.reason], [false, 'dns_failed']);
});

test('robots.txt는 이동한 최종 주소의 것을 읽고, 경로까지 본다', async () => {
  const log = [];
  const a = await runAudit('old.example', { fetcher: fake({
    'https://old.example/': { body: GOOD_HOME, finalUrl: 'https://www.new.example/main/index.php' },
    'https://www.new.example/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /main/\n' },
  }, log) });
  assert.ok(log.includes('https://www.new.example/robots.txt'));
  assert.equal(log.includes('https://old.example/robots.txt'), false);
  assert.equal(a.doors.chatgpt.state, 'shut');
  assert.equal(a.engines.naver, false);
  assert.ok(scoreAudit(a).critical.some((c) => c.includes('네이버')));
});

test('없는 주소에 메인 화면을 주는 사이트: 사이트맵 없음으로 본다', async () => {
  const a = await runAudit('soft.example', { fetcher: fake({
    'https://soft.example/': { body: GOOD_HOME },
    'https://soft.example/robots.txt': { body: GOOD_HOME },
    'https://soft.example/sitemap.xml': { body: GOOD_HOME },
  }) });
  assert.equal(a.robots.state, 'none');
  assert.equal(a.pages.sitemap, 'none');
  assert.equal(a.hygiene.sitemap, false);
});

test('noindex(메타·헤더)는 치명 알림으로 올린다', async () => {
  const a = await runAudit('no.example', { fetcher: fake({
    'https://no.example/': { body: GOOD_HOME.replace('<meta name="viewport"', '<meta name="robots" content="noindex,nofollow"><meta name="viewport"') },
  }) });
  assert.equal(a.noindex.all, true);
  assert.ok(scoreAudit(a).critical.some((c) => c.includes('noindex')));
  const b = await runAudit('hd.example', { fetcher: fake({ 'https://hd.example/': { body: GOOD_HOME, headers: { 'x-robots-tag': 'googlebot: noindex' } } }) });
  assert.deepEqual([b.noindex.google, b.noindex.all], [true, false]);
});

test('frameset 홈페이지는 안쪽 화면을 읽는다', async () => {
  const a = await runAudit('frame.example', { fetcher: fake({
    'https://frame.example/': { body: '<html><head><title>옛날치과의원</title></head><frameset rows="*"><frame src="/main.php"></frameset></html>' },
    'https://frame.example/main.php': { body: '<html><body><p>진료시간 평일 09:30 ~ 18:30</p><p>전화 031-555-0100</p></body></html>' },
  }) });
  assert.equal(a.framed, true);
  assert.equal(a.basic.phone, true); assert.equal(a.basic.hours, true);
  assert.equal(a.hygiene.titleText, '옛날치과의원');
});

test('학습만 막은 곳은 감점하지 않고 따로 알려 준다', async () => {
  const a = await runAudit('raon.example', { fetcher: fake({
    'https://raon.example/': { body: GOOD_HOME },
    'https://raon.example/robots.txt': { type: 'text/plain', body: 'User-agent: GPTBot\nDisallow: /\n' },
  }) });
  const s = scoreAudit(a);
  assert.equal(s.items.find((x) => x.id === 'ai').got, 16);
  assert.deepEqual(s.trainingOff, [a.doors.chatgpt.label]);
});

test('광고 문구의 물음표는 질문으로 세지 않는다, 전문의 한 줄만으로는 의료진 확인이 아니다', async () => {
  const home = '<html><head><title>가나성형외과의원</title></head><body><p>아직도 고민하시나요?</p><p>왜 가나성형외과일까요?</p><p>수술이 두려우신가요?</p><p>성형외과 전문의가 진료합니다. 대한성형외과학회</p></body></html>';
  const a = await runAudit('gana.example', { fetcher: fake({ 'https://gana.example/': { body: home } }) });
  assert.equal(a.faq.questions, 0);
  assert.equal(a.doctors.verified, false);
});

test('글자도 이미지도 없는 빈 화면(나중에 그려 넣는 방식)은 읽을 글자 0점', async () => {
  const a = await runAudit('spa.example', { fetcher: fake({ 'https://spa.example/': { body: '<html><head><title>스파의원</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>' } }) });
  const s = scoreAudit(a);
  const t = s.items.find((x) => x.id === 'text');
  assert.equal(t.got, 0);
  assert.equal(s.ladder.find((l) => l.id === 'text').gain, 16);
  assert.equal(s.ladder.some((l) => l.id === 'alt'), false);
  assert.equal(s.score + s.ladder.reduce((n, x) => n + x.gain, 0), 100);
});

test('글자 없이 다른 화면으로 넘기는 첫 주소(meta refresh·스크립트)는 따라가서 읽는다', async () => {
  const log = [];
  const a = await runAudit('jump.example', { fetcher: fake({
    'https://jump.example/': { body: '<html><head><meta http-equiv="Refresh" content="0; URL=default/"></head></html>' },
    'https://jump.example/default/': { body: '<html><body><script>location.href="/main.php";</script></body></html>' },
    'https://jump.example/main.php': { body: GOOD_HOME },
    'https://jump.example/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /default/\n' },
  }, log) });
  assert.equal(a.finalUrl, 'https://jump.example/main.php');
  assert.ok(a.text.chars > 1000);
  assert.equal(a.doors.chatgpt.state, 'open', '마지막 화면의 경로로 출입 규칙을 본다');
  const out = await runAudit('away.example', { fetcher: fake({ 'https://away.example/': { body: '<html><head><meta http-equiv="refresh" content="0;url=https://other.example/"></head></html>' } }, log) });
  assert.equal(log.includes('https://other.example/'), false, '다른 사이트로는 따라가지 않는다');
  assert.equal(out.text.chars, 0);
});
