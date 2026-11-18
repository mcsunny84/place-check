'use strict';
// robots.txt 해석(RFC 9309)과 4대 AI 출입 판정.
//  - 같은 로봇을 가리키는 그룹은 합친다. 이름이 맞는 그룹이 없으면 `*` 그룹을 쓴다.
//  - 경로는 가장 길게 맞는 규칙이 이긴다. 길이가 같으면 허용이 이긴다. `*`(아무 글자)와 `$`(끝)를 지원한다.
//  - 빈 Disallow는 "막는 것 없음"이다.

function parseRobots(text) {
  const groups = []; // { agents:[소문자], rules:[{allow:boolean, pattern:string}] }
  let cur = null, lastWasAgent = false;
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (!cur) continue; // 로봇 이름 없이 나온 규칙은 버린다
      if (val === '') continue; // 빈 값은 규칙 없음
      cur.rules.push({ allow: key === 'allow', pattern: val });
    } else {
      // sitemap, crawl-delay 등은 그룹 구분에 영향을 주지 않는다
    }
  }
  return groups;
}

function hasRuleLines(text) {
  return /^\s*user-agent\s*:/im.test(String(text || '')) && /^\s*(dis)?allow\s*:/im.test(String(text || ''));
}

function sitemapUrls(text) {
  const out = [];
  for (const line of String(text || '').split(/\r\n|\r|\n/)) {
    const m = line.match(/^\s*sitemap\s*:\s*(\S+)/i);
    if (m) out.push(m[1]);
  }
  return out;
}

// 로봇 이름(제품 토큰)에 맞는 규칙 묶음. 맞는 그룹이 없으면 `*`.
function rulesFor(groups, agent) {
  const a = String(agent).toLowerCase();
  const named = groups.filter((g) => g.agents.includes(a));
  const pick = named.length ? named : groups.filter((g) => g.agents.includes('*'));
  return { rules: pick.flatMap((g) => g.rules), named: named.length > 0 };
}

const MAX_RULES = 2000, MAX_PATTERN = 500, MAX_PATH = 2000;

// 경로·규칙의 %XX 표기를 같은 꼴로 맞춘다(RFC 9309 2.2.2): 안 묶어도 되는 글자는 풀고, 나머지는 대문자 %XX, 한글 같은 글자는 UTF-8 %XX.
function normOctets(str) {
  const s = String(str); let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '%' && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      const byte = parseInt(s.slice(i + 1, i + 3), 16); const ch = String.fromCharCode(byte);
      out += /[A-Za-z0-9-._~]/.test(ch) ? ch : '%' + s.slice(i + 1, i + 3).toUpperCase();
      i += 2; continue;
    }
    const cp = s.codePointAt(i);
    if (cp > 127) { const ch = String.fromCodePoint(cp); try { out += encodeURIComponent(ch); } catch { out += ch; } if (cp > 0xffff) i++; continue; }
    out += c;
  }
  return out;
}

// 정규식을 쓰지 않는 무늬 비교(되돌아가기 폭주 없음, 최악 O(무늬×경로)). '*'는 아무 글자, 끝의 '$'는 경로 끝.
function matchPattern(pattern, path) {
  let p = pattern; let anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  if (!anchored) p += '*'; // 앞부분만 맞으면 된다
  let i = 0, j = 0, star = -1, mark = 0;
  while (i < path.length) {
    if (j < p.length && p[j] === '*') { star = j++; mark = i; }
    else if (j < p.length && p[j] === path[i]) { i++; j++; }
    else if (star !== -1) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (j < p.length && p[j] === '*') j++;
  return j === p.length;
}

function isAllowed(groups, agent, path) {
  const { rules } = rulesFor(groups, agent);
  const target = normOctets(String(path || '/').slice(0, MAX_PATH));
  let best = null; // { len, allow }
  for (const r of rules.slice(0, MAX_RULES)) {
    if (r.pattern.length > MAX_PATTERN) continue;
    const pat = normOctets(r.pattern);
    if (!matchPattern(pat, target)) continue;
    const len = pat.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };
  }
  return best ? best.allow : true;
}

// robots.txt 요청 결과를 세 가지로: 규칙 있음 / 없음(전부 허용) / 확인 못 함
function classifyRobotsResponse(res, decodedText) {
  if (!res || !res.ok) return { state: 'unknown', reason: (res && res.unavailable_reason) || 'fetch_failed', groups: null, text: '' };
  const text = String(decodedText || '');
  if (res.status === 404 || res.status === 410) return { state: 'none', groups: [], text: '' };
  if (res.status >= 200 && res.status < 300) {
    if (hasRuleLines(text)) return { state: 'rules', groups: parseRobots(text), text };
    // 200인데 규칙 줄이 없다: 진짜 빈 파일이거나, 없는 주소에 메인 화면을 돌려주는 사이트
    if (/<html|<!doctype/i.test(text)) return { state: 'none', groups: [], text: '', note: 'html_instead' };
    return { state: 'none', groups: [], text };
  }
  return { state: 'unknown', reason: 'status_' + res.status, groups: null, text: '' };
}

const AI = {
  chatgpt:    { label: '챗GPT',     search: 'OAI-SearchBot',     training: 'GPTBot',    user: 'ChatGPT-User' },
  claude:     { label: '클로드',    search: 'Claude-SearchBot',  training: 'ClaudeBot', user: 'Claude-User' },
  gemini:     { label: '제미나이',  search: 'Googlebot',         training: null,        user: null, usage: 'Google-Extended' },
  perplexity: { label: '퍼플렉시티', search: 'PerplexityBot',     training: null,        user: 'Perplexity-User' },
};

// 문 색은 검색용 로봇만으로 정한다. 학습용은 따로 알려 주기만 한다(감점 아님).
function aiDoors(robots, path) {
  const out = {};
  for (const [id, a] of Object.entries(AI)) {
    if (!robots || robots.state === 'unknown') { out[id] = { label: a.label, state: 'unknown', search: null, training: null, usage: null }; continue; }
    const g = robots.groups || [];
    const search = isAllowed(g, a.search, path);
    const training = a.training ? isAllowed(g, a.training, path) : null;
    const usage = a.usage ? isAllowed(g, a.usage, path) : null;
    let state = search ? 'open' : 'shut';
    if (id === 'gemini' && search && usage === false) state = 'half';
    out[id] = { label: a.label, state, search, training, usage, named: rulesFor(g, a.search).named };
  }
  return out;
}

function searchEngines(robots, path) {
  if (!robots || robots.state === 'unknown') return { naver: null, google: null };
  const g = robots.groups || [];
  return { naver: isAllowed(g, 'Yeti', path), google: isAllowed(g, 'Googlebot', path) };
}

module.exports = { parseRobots, isAllowed, rulesFor, classifyRobotsResponse, aiDoors, searchEngines, sitemapUrls, hasRuleLines, AI };
