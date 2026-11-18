'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../lib/hospital/robots');

const al = (txt, agent, path = '/') => R.isAllowed(R.parseRobots(txt), agent, path);

test('규칙이 없으면 허용, 전체 차단은 차단', () => {
  assert.equal(al('', 'GPTBot'), true);
  assert.equal(al('User-agent: *\nDisallow: /', 'OAI-SearchBot'), false);
  assert.equal(al('User-agent: *\nDisallow:', 'OAI-SearchBot'), true, '빈 Disallow는 허용');
});

test('이름이 맞는 그룹이 있으면 * 그룹은 쓰지 않는다', () => {
  const t = 'User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /';
  assert.equal(al(t, 'OAI-SearchBot'), true);
  assert.equal(al(t, 'PerplexityBot'), false);
});

test('가장 길게 맞는 규칙이 이기고, 길이가 같으면 허용', () => {
  assert.equal(al('User-agent: Yeti\nAllow: /\nDisallow: /', 'Yeti'), true, '동률은 허용');
  assert.equal(al('User-agent: Yeti\nDisallow: /*', 'Yeti'), false, '/*도 전체 차단');
  assert.equal(al('User-agent: *\nDisallow: /admin\nAllow: /', 'Yeti', '/admin/x'), false);
  assert.equal(al('User-agent: *\nDisallow: /\nAllow: /main', 'Yeti', '/main/index'), true);
  assert.equal(al('User-agent: *\nAllow: /\nDisallow: /index.html', 'Yeti', '/index.html'), false, '첫 화면이 이동한 경로를 본다');
});

test('*와 $ 무늬', () => {
  assert.equal(al('User-agent: *\nDisallow: /*.php$', 'Yeti', '/a.php'), false);
  assert.equal(al('User-agent: *\nDisallow: /*.php$', 'Yeti', '/a.php?x=1'), true);
  assert.equal(al('User-agent: *\nDisallow: /*.hwp', 'Yeti', '/'), true);
});

test('같은 로봇 그룹은 합치고, 여러 로봇을 한 그룹에 쓸 수 있다', () => {
  const t = 'User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /open';
  assert.equal(al(t, 'GPTBot', '/'), false);
  assert.equal(al(t, 'ClaudeBot', '/'), false);
  assert.equal(al(t, 'GPTBot', '/open/1'), true);
  assert.equal(al(t, 'OAI-SearchBot', '/'), true, '이름 없는 로봇은 규칙 없음');
});

test('주석·대소문자·BOM·CRLF', () => {
  const t = '﻿USER-AGENT: gptbot # 학습\r\nDISALLOW: / # 전부\r\n';
  assert.equal(al(t, 'GPTBot'), false);
});

test('응답 분류: 404는 없음, 5xx·403·실패는 확인 못 함, HTML 속 규칙은 적용', () => {
  assert.equal(R.classifyRobotsResponse({ ok: true, status: 404 }, '<html>없음</html>').state, 'none');
  assert.equal(R.classifyRobotsResponse({ ok: true, status: 410 }, '').state, 'none');
  assert.equal(R.classifyRobotsResponse({ ok: true, status: 403 }, 'Forbidden').state, 'unknown');
  assert.equal(R.classifyRobotsResponse({ ok: true, status: 503 }, '').state, 'unknown');
  assert.equal(R.classifyRobotsResponse({ ok: true, status: 429 }, '').state, 'unknown');
  assert.equal(R.classifyRobotsResponse({ ok: false, unavailable_reason: 'timeout' }, '').state, 'unknown');
  const html = R.classifyRobotsResponse({ ok: true, status: 200 }, '<!doctype html><html><body>메인</body></html>');
  assert.equal(html.state, 'none'); assert.equal(html.note, 'html_instead');
  const mixed = R.classifyRobotsResponse({ ok: true, status: 200 }, 'User-agent: *\nDisallow: /\n');
  assert.equal(mixed.state, 'rules');
  assert.equal(R.isAllowed(mixed.groups, 'Yeti', '/'), false);
});

test('4대 AI: 문 색은 검색 로봇만, 학습만 막으면 열림', () => {
  const only = R.classifyRobotsResponse({ ok: true, status: 200 }, 'User-agent: GPTBot\nDisallow: /\nUser-agent: ClaudeBot\nDisallow: /\n');
  const d = R.aiDoors(only, '/');
  assert.equal(d.chatgpt.state, 'open'); assert.equal(d.chatgpt.training, false);
  assert.equal(d.claude.state, 'open'); assert.equal(d.claude.training, false);
  assert.equal(d.perplexity.state, 'open');
});

test('4대 AI: 검색 로봇을 막으면 막힘, 제미나이 이용만 끄면 반만 열림', () => {
  const t = R.classifyRobotsResponse({ ok: true, status: 200 }, 'User-agent: Claude-SearchBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\nUser-agent: Google-Extended\nDisallow: /\n');
  const d = R.aiDoors(t, '/');
  assert.equal(d.chatgpt.state, 'open');
  assert.equal(d.claude.state, 'shut');
  assert.equal(d.perplexity.state, 'shut');
  assert.equal(d.gemini.state, 'half');
  const all = R.aiDoors(R.classifyRobotsResponse({ ok: true, status: 200 }, 'User-agent: *\nDisallow: /'), '/');
  assert.deepEqual([all.chatgpt.state, all.claude.state, all.gemini.state, all.perplexity.state], ['shut', 'shut', 'shut', 'shut']);
});

test('4대 AI: robots.txt를 확인하지 못하면 전부 확인 못 함, 없으면 전부 열림', () => {
  const u = R.aiDoors(R.classifyRobotsResponse({ ok: true, status: 503 }, ''), '/');
  assert.equal(u.chatgpt.state, 'unknown'); assert.equal(u.gemini.state, 'unknown');
  const n = R.aiDoors(R.classifyRobotsResponse({ ok: true, status: 404 }, ''), '/');
  assert.equal(n.claude.state, 'open');
});

test('사이트맵 주소 줄을 읽는다', () => {
  assert.deepEqual(R.sitemapUrls('Sitemap: https://a.kr/s1.xml\nsitemap: https://a.kr/s2.xml\nUser-agent: *'), ['https://a.kr/s1.xml', 'https://a.kr/s2.xml']);
});

test('악의적인 무늬(별표 반복)에도 바로 끝난다', () => {
  const evil = 'User-agent: *\nDisallow: /' + '*a'.repeat(24) + 'b$\n';
  const t0 = Date.now();
  assert.equal(al(evil, 'OAI-SearchBot', '/' + 'a'.repeat(80)), true);
  assert.equal(al('User-agent: *\nDisallow: /' + '*a'.repeat(200) + '\n', 'Yeti', '/' + 'a'.repeat(1500) + 'c'), false);
  assert.equal(al('User-agent: *\nDisallow: /' + '*a'.repeat(200) + 'z$\n', 'Yeti', '/' + 'a'.repeat(1500) + 'c'), true);
  assert.ok(Date.now() - t0 < 500, '걸린 시간 ' + (Date.now() - t0) + 'ms');
});

test('한글 경로와 %XX 표기를 같은 것으로 본다', () => {
  assert.equal(al('User-agent: *\nDisallow: /진료', 'Yeti', new URL('https://a.kr/진료/피부').pathname), false);
  assert.equal(al('User-agent: *\nDisallow: /%EC%A7%84%EB%A3%8C', 'Yeti', '/진료'), false);
  assert.equal(al('User-agent: *\nDisallow: /~doctor', 'Yeti', '/%7Edoctor'), false);
  assert.equal(al('User-agent: *\nDisallow: /a%2fb', 'Yeti', '/a%2Fb'), false);
  assert.equal(al('User-agent: *\nDisallow: /a%2Fb', 'Yeti', '/a/b'), true, '묶인 / 는 풀지 않는다');
});
