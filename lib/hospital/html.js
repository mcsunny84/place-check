'use strict';
// HTML 읽기. 정규식으로 태그를 찾지 않고 글자 단위로 읽는다(주석·script·style·속성 속 '>' 를 실제 내용으로 세지 않기 위해).

const CHARSET_ALIAS = { 'ks_c_5601-1987': 'euc-kr', 'ksc5601': 'euc-kr', 'ks_c_5601': 'euc-kr', 'cp949': 'euc-kr', 'x-windows-949': 'euc-kr', 'windows-949': 'euc-kr', 'euc_kr': 'euc-kr', 'utf8': 'utf-8' };
function normCharset(c) { const k = String(c || '').trim().toLowerCase().replace(/^["']|["']$/g, ''); return CHARSET_ALIAS[k] || k; }

function charsetFromContentType(ct) { const m = String(ct || '').match(/charset\s*=\s*["']?([^\s;"']+)/i); return m ? normCharset(m[1]) : ''; }

// 응답 바이트 → 글자. 헤더 → BOM → meta 순으로 인코딩을 찾는다. 해독할 수 없으면 null(=확인 못 함).
function decodeHtml(buf, contentType) {
  if (!Buffer.isBuffer(buf)) return null;
  let charset = charsetFromContentType(contentType);
  if (!charset && buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) charset = 'utf-8';
  if (!charset) {
    const head = buf.subarray(0, 4096).toString('latin1');
    const m = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_-]+)/i);
    if (m) charset = normCharset(m[1]);
  }
  const declared = !!charset;
  if (!charset) charset = 'utf-8';
  let text;
  try { text = new TextDecoder(charset, { fatal: false }).decode(buf); } catch { return null; }
  if (!declared) {
    // 선언이 없는데 UTF-8로 깨지면 한국어 옛 인코딩일 가능성이 크다
    const bad = (text.match(/�/g) || []).length;
    if (bad > 20 && bad / Math.max(1, text.length) > 0.005) {
      try { const alt = new TextDecoder('euc-kr').decode(buf); if ((alt.match(/�/g) || []).length < bad / 4) return { text: alt, charset: 'euc-kr', guessed: true }; } catch { /* 그대로 */ }
    }
  }
  return { text, charset, guessed: !declared };
}

const RAW = new Set(['script', 'style', 'textarea', 'title', 'noscript', 'template', 'iframe', 'xmp']);
const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'base', 'area', 'col', 'embed', 'source', 'track', 'wbr', 'frame']);
const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'tr', 'td', 'th', 'table', 'br', 'dt', 'dd', 'dl', 'form', 'button', 'a', 'figure', 'figcaption', 'blockquote', 'address', 'summary', 'details']);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', copy: '©', reg: '®', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
function unescapeHtml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
    const v = ENT[e.toLowerCase()]; return v === undefined ? m : v;
  });
}
const squash = (s) => unescapeHtml(s).replace(/[\s ​]+/g, ' ').trim();

// 태그 하나를 읽는다. i는 '<' 다음 위치. 반환: { name, attrs, selfClose, end }
function readTag(html, i) {
  const n = html.length; let j = i; let closing = false;
  if (html[j] === '/') { closing = true; j++; }
  const s = j;
  while (j < n && /[A-Za-z0-9:-]/.test(html[j])) j++;
  const name = html.slice(s, j).toLowerCase();
  const attrs = {};
  let selfClose = false;
  while (j < n) {
    while (j < n && /\s/.test(html[j])) j++;
    if (j >= n) break;
    if (html[j] === '>') { j++; break; }
    if (html[j] === '/') { selfClose = true; j++; continue; }
    const as = j;
    while (j < n && !/[\s=>/]/.test(html[j])) j++;
    const an = html.slice(as, j).toLowerCase();
    while (j < n && /\s/.test(html[j])) j++;
    let av = '';
    if (html[j] === '=') {
      j++;
      while (j < n && /\s/.test(html[j])) j++;
      const q = html[j];
      if (q === '"' || q === "'") { const e = html.indexOf(q, j + 1); const stop = e === -1 ? n : e; av = html.slice(j + 1, stop); j = stop + 1; }
      else { const vs = j; while (j < n && !/[\s>]/.test(html[j])) j++; av = html.slice(vs, j); }
    }
    if (an && !(an in attrs)) attrs[an] = unescapeHtml(av);
    if (!an && j === as) j++; // 진행 보장
  }
  return { name, attrs, closing, selfClose, end: j };
}

function flattenJsonLd(node, out, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) { for (const x of node) flattenJsonLd(x, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  if (node['@type']) out.push(node);
  if (node['@graph']) flattenJsonLd(node['@graph'], out, depth + 1);
  for (const k of ['mainEntity', 'mainEntityOfPage', 'itemListElement', 'department', 'employee', 'member']) if (node[k] && typeof node[k] === 'object') flattenJsonLd(node[k], out, depth + 1);
}

function scan(html) {
  html = String(html || '');
  const n = html.length;
  const r = {
    title: '', metas: [], links: [], anchors: [], headings: [], images: { total: 0, withAlt: 0 },
    jsonld: [], jsonldBroken: 0, hasMicrodata: false, hasRdfa: false, microTypes: [], frames: [], hasBody: false,
    bodyText: '', lines: [], scriptCount: 0, lang: '',
  };
  let i = 0, inBody = false, sawBody = false;
  let curA = null, curH = null, hidden = 0;
  const lines = []; let line = '';
  const flush = () => { const t = squash(line); if (t) lines.push(t); line = ''; };
  const addText = (t) => {
    if (!t) return;
    if (curA) curA.text += t;
    if (curH) curH.text += t;
    if ((inBody || !sawBody) && !hidden) line += t;
  };
  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e === -1 ? n : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { const e = html.indexOf('>', lt); i = e === -1 ? n : e + 1; continue; }
    if (!/[A-Za-z/]/.test(html[lt + 1] || '')) { addText('<'); i = lt + 1; continue; }
    const tag = readTag(html, lt + 1);
    i = tag.end;
    const name = tag.name;
    if (!name) continue;
    if (tag.closing) {
      if (name === 'a' && curA) { r.anchors.push({ href: curA.href, text: squash(curA.text) }); curA = null; }
      if (/^h[1-3]$/.test(name) && curH) { const t = squash(curH.text); if (t) r.headings.push({ level: Number(name[1]), text: t }); curH = null; }
      if (name === 'body') inBody = false;
      if (BLOCK.has(name)) flush();
      continue;
    }
    const a = tag.attrs;
    if ('itemscope' in a || a.itemtype) { r.hasMicrodata = true; if (a.itemtype) r.microTypes.push(a.itemtype.split('/').pop()); }
    if (a.typeof || a.vocab) { r.hasRdfa = true; if (a.typeof) r.microTypes.push(a.typeof); }
    if (name === 'html' && a.lang) r.lang = a.lang.toLowerCase();
    if (name === 'body') { inBody = true; sawBody = true; r.hasBody = true; line = ''; lines.length = 0; }
    if (name === 'meta') r.metas.push({ name: (a.name || '').toLowerCase(), property: (a.property || '').toLowerCase(), httpEquiv: (a['http-equiv'] || '').toLowerCase(), content: a.content || '', charset: a.charset || '' });
    if (name === 'link') r.links.push({ rel: (a.rel || '').toLowerCase(), href: a.href || '', type: (a.type || '').toLowerCase() });
    if (name === 'img') { r.images.total++; if ((a.alt || '').trim().length >= 2) r.images.withAlt++; }
    if (name === 'frame' || name === 'iframe') { if (a.src) r.frames.push({ kind: name, src: a.src }); }
    if (name === 'a') curA = { href: a.href || '', text: '' };
    if (/^h[1-3]$/.test(name)) curH = { text: '' };
    if (BLOCK.has(name)) flush();
    if (RAW.has(name) && !tag.selfClose) {
      const closeRe = new RegExp('</' + name + '\\s*>', 'i');
      const rest = html.slice(i);
      const m = closeRe.exec(rest);
      const inner = m ? rest.slice(0, m.index) : rest;
      i = m ? i + m.index + m[0].length : n;
      if (name === 'title' && !r.title) r.title = squash(inner);
      if (name === 'script') {
        r.scriptCount++;
        if (/ld\+json/i.test(a.type || '')) {
          try { flattenJsonLd(JSON.parse(inner.trim()), r.jsonld); } catch { r.jsonldBroken++; }
        }
      }
      if (name === 'textarea') { /* 입력칸 기본값은 본문으로 세지 않는다 */ }
      continue;
    }
    if (VOID.has(name) || tag.selfClose) continue;
  }
  flush();
  r.lines = lines;
  r.bodyText = lines.join(' ');
  return r;
}

// 한글·영문·숫자 글자 수(공백·기호 제외) — "읽을 글자"의 양
function countChars(s) { return (String(s || '').match(/[\p{L}\p{N}]/gu) || []).length; }

module.exports = { decodeHtml, scan, countChars, squash, charsetFromContentType };
