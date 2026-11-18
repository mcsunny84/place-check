'use strict';
// 병원 홈페이지 한 곳을 읽고 사실만 모은다(점수는 score.js). AI 호출 없음.
// 요청 수 상한: 첫 화면 1 + 프레임 1 + robots 1 + 사이트맵 4 + 안쪽 페이지 3 = 10.
const { safeFetch } = require('./safe-fetch');
const R = require('./robots');
const H = require('./html');

const MAX_SITEMAP_FETCH = 4, MAX_SITEMAP_URLS = 2000;
const MEDICAL_TYPES = new Set(['medicalclinic', 'hospital', 'dentist', 'physician', 'medicalorganization', 'medicalbusiness', 'dermatology', 'plasticsurgery', 'optician', 'pharmacy', 'diagnosticlab', 'veterinarycare', 'individualphysician', 'physiciansoffice']);
const BUSINESS_TYPES = new Set(['localbusiness', 'organization', 'healthandbeautybusiness', 'beautysalon', 'store', 'corporation']);

const RX = {
  phone: /(?:0\d{1,2}[-.)\s]{1,2}\d{3,4}[-.\s]\d{4}|1[5-8]\d{2}[-\s]?\d{4})/,
  address: /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|충청|전라|경상)[^\n]{0,40}?(로|길)\s?\d+/,
  hoursWord: /(진료\s?시간|진료\s?안내|평일|월\s?[~\-–]\s?금|월요일|토요일|점심\s?시간|휴진|야간\s?진료)/,
  hoursTime: /\d{1,2}\s?(?::|시)\s?\d{0,2}\s?(?:분)?\s?[~\-–]\s?\d{1,2}\s?(?::|시)/,
  doctorLink: /(의료진|원장\s?(소개|님)|대표\s?원장|전문의|doctor|의사\s?소개|진료진)/i,
  doctorProof: /(전문의|의학박사|인정의|정회원)/,
  doctorCareer: /(약력|학력|경력|졸업|수료|전임의|레지던트|인턴|학회|외래교수|석사|박사)/g,
  faqLink: /(자주\s?묻는|faq|q\s?&\s?a|질문과\s?답|궁금)/i,
  infoLink: /(오시는\s?길|찾아오시는|진료\s?(시간|안내)|병원\s?(소개|안내)|location|contact|약도)/i,
  genericTitle: /^(home|홈|index|main|메인|무제|untitled|welcome)$/i,
};

function normalizeInput(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u; try { u = new URL(s); } catch { return null; }
  if (u.username || u.password || u.port) return null; // 기본 포트 주소만 점검한다
  if (u.hostname.endsWith('.')) u.hostname = u.hostname.slice(0, -1);
  if (!/\./.test(u.hostname) || /\s/.test(u.hostname)) return null;
  u.hash = '';
  return u;
}

// 글자 없는 화면이 가리키는 다음 주소(같은 사이트만). 없으면 null.
function redirectTarget(scan, raw, base) {
  let to = null;
  const meta = scan.metas.find((m) => m.httpEquiv === 'refresh' && /url\s*=/i.test(m.content));
  if (meta) to = meta.content.replace(/^[^=]*=\s*/, '').replace(/^['"]|['"]$/g, '').trim();
  if (!to) {
    // 누르면 이동(onclick)·함수 안·조건문 안의 이동은 자동 이동이 아니다 → 함수·조건이 없는 짧은 스크립트만 본다
    for (const sc of scan.inlineScripts || []) {
      if (sc.length > 300 || /function|=>|\bif\b|addEventListener|setTimeout|onclick/.test(sc)) continue;
      const m = sc.match(/^(?:window\.|document\.|self\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']{1,300})["']\s*;?$|^(?:window\.|document\.)?location\.(?:replace|assign)\(\s*["']([^"']{1,300})["']\s*\)\s*;?$/);
      if (m) { to = m[1] || m[2]; break; }
    }
  }
  if (!to) return null;
  let u; try { u = new URL(to, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, base.hostname) || u.href === base.href) return null;
  return u;
}

function looksBlocked(status, text) {
  if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
  const t = String(text || '').slice(0, 3000);
  return /(captcha|access denied|attention required|just a moment|보안\s?문자|접근이\s?차단|비정상적인\s?접근)/i.test(t) && H.countChars(t) < 600;
}

async function fetchPage(fetcher, url) {
  const res = await fetcher(url, { maxBodyBytes: 3 * 1024 * 1024, truncate: true });
  if (!res || !res.ok) return { ok: false, reason: (res && res.unavailable_reason) || 'fetch_failed' };
  const dec = H.decodeHtml(res.body, res.headers && res.headers['content-type']);
  if (!dec) return { ok: false, reason: 'undecodable', status: res.status };
  if (looksBlocked(res.status, dec.text)) return { ok: false, reason: 'blocked', status: res.status };
  if (res.status >= 400) return { ok: false, reason: 'status_' + res.status, status: res.status };
  return { ok: true, status: res.status, headers: res.headers || {}, text: dec.text, finalUrl: res.finalUrl, ms: res.ms };
}

function sameSite(a, b) { const s = (h) => h.replace(/^www\./, '').toLowerCase(); return s(a) === s(b); }

function pickLink(scan, base, re) {
  for (const a of scan.anchors) {
    if (!a.href || /^(javascript:|#|mailto:|tel:)/i.test(a.href)) continue;
    if (!re.test(a.text) && !re.test(a.href)) continue;
    let u; try { u = new URL(a.href, base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, base.hostname)) continue;
    u.hash = '';
    if (u.href === base.href) continue;
    return u;
  }
  return null;
}

function internalLinkCount(scan, base) {
  const set = new Set();
  for (const a of scan.anchors) {
    if (!a.href || /^(javascript:|#|mailto:|tel:)/i.test(a.href)) continue;
    let u; try { u = new URL(a.href, base); } catch { continue; }
    if (!sameSite(u.hostname, base.hostname)) continue;
    u.hash = ''; set.add(u.pathname + u.search);
  }
  set.delete(base.pathname + base.search);
  return set.size;
}

// 지시어를 쉼표로 나눠 정확히 noindex·none 인 것만 본다. "googlebot: nofollow, noindex"처럼 로봇 이름으로 시작한 줄은 그 줄 끝까지 그 로봇 것.
function noindexFor(scan, headers) {
  const hit = { all: false, google: false, naver: false };
  const BOTS = { robots: 'all', googlebot: 'google', yeti: 'naver', naverbot: 'naver' };
  const apply = (who, content) => {
    const key = BOTS[who]; if (!key) return;
    if (String(content).split(',').some((d) => /^(noindex|none)$/i.test(d.trim()))) hit[key] = true;
  };
  for (const m of scan.metas) apply(m.name, m.content);
  for (const line of [].concat((headers && headers['x-robots-tag']) || [])) {
    const m = String(line).match(/^\s*([a-z0-9_-]+)\s*:\s*(.*)$/i);
    // "max-snippet: -1"처럼 값이 붙는 지시어는 로봇 이름이 아니다
    if (m && !/^(max-snippet|max-image-preview|max-video-preview|unavailable_after)$/i.test(m[1])) apply(m[1].toLowerCase(), m[2]);
    else apply('robots', line);
  }
  return hit;
}

// 값이 실제로 들어 있는가(빈 배열·빈 객체·공백은 아님)
function meaningful(v, depth = 0) {
  if (v === null || v === undefined || depth > 4) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (typeof v === 'number') return true;
  if (Array.isArray(v)) return v.some((x) => meaningful(x, depth + 1));
  if (typeof v === 'object') return Object.keys(v).some((k) => k[0] !== '@' && meaningful(v[k], depth + 1));
  return false;
}
const typesOf = (n) => [].concat((n && n['@type']) || []).map((t) => String(t).toLowerCase());

function structured(scans) {
  const nodes = scans.flatMap((s) => s.jsonld);
  const types = new Set();
  for (const n of nodes) for (const t of typesOf(n)) types.add(t);
  for (const s of scans) for (const t of s.microTypes) types.add(String(t).toLowerCase());
  const any = nodes.length > 0 || scans.some((s) => s.hasMicrodata || s.hasRdfa);
  const medical = [...types].some((t) => MEDICAL_TYPES.has(t));
  const business = [...types].some((t) => BUSINESS_TYPES.has(t));
  // 병원 정보는 한 덩어리에서 고른다: 병원 종류가 먼저, 그다음 채워진 칸이 많은 것(앞에 제작사·사이트 정보가 있어도 밀리지 않게)
  const fieldsOf = (n) => ({ name: meaningful(n.name), address: meaningful(n.address), telephone: meaningful(n.telephone), hours: meaningful(n.openingHours) || meaningful(n.openingHoursSpecification) });
  const rank = (n) => (typesOf(n).some((t) => MEDICAL_TYPES.has(t)) ? 10 : 0) + Object.values(fieldsOf(n)).filter(Boolean).length;
  const cands = nodes.filter((n) => typesOf(n).some((t) => MEDICAL_TYPES.has(t) || BUSINESS_TYPES.has(t)));
  const org = cands.sort((x, y) => rank(y) - rank(x))[0] || null;
  let fields = org ? fieldsOf(org) : { name: false, address: false, telephone: false, hours: false };
  let sameAs = !!(org && [].concat(org.sameAs || []).some((x) => typeof x === 'string' && /^https?:\/\/[^\s/]+\.[^\s/]+/.test(x)));
  let person = nodes.some((n) => typesOf(n).includes('person') && meaningful(n.name));
  // Microdata·RDFa로 적은 곳: 속성 이름이 있으면 같은 칸으로 본다
  const micro = scans.filter((s) => s.hasMicrodata || s.hasRdfa);
  if (micro.length && (medical || business)) {
    const ip = (k) => micro.some((s) => s.itemprops && s.itemprops[k]);
    fields = { name: fields.name || ip('name'), address: fields.address || ip('address') || ip('streetaddress'), telephone: fields.telephone || ip('telephone'), hours: fields.hours || ip('openinghours') || ip('openinghoursspecification') };
    sameAs = sameAs || ip('sameas');
    person = person || (types.has('person') && micro.some((s) => s.itemprops && s.itemprops.name >= 2));
  }
  // FAQ 표시는 질문과 답이 실제로 들어 있을 때만
  const answered = (q) => meaningful(q && q.acceptedAnswer) || meaningful(q && q.suggestedAnswer);
  const faq = nodes.some((n) => typesOf(n).includes('question') && meaningful(n.name) && answered(n))
    || micro.some((s) => s.microTypes.some((t) => /^question$/i.test(t)) && s.itemprops && s.itemprops.acceptedanswer);
  return { any, medical, business, faq, types: [...types].slice(0, 12), fields, person, sameAs, broken: scans.reduce((n, s) => n + s.jsonldBroken, 0) };
}

// 메뉴 이름·버튼 글자를 뺀 '설명 문장' 글자 수: 25자 이상인 줄만, 같은 줄 반복(슬라이드)은 한 번만
function proseChars(lines) {
  const seen = new Set(); let n = 0;
  for (const l of lines) { if (l.length < 25 || seen.has(l)) continue; seen.add(l); n += H.countChars(l); }
  return n;
}

function questionLines(scan) {
  return scan.lines.filter((l) => l.length >= 6 && l.length <= 120 && (/[?？]\s*$/.test(l) || /^(q[\s.:)]|q\d|질문)/i.test(l))).length;
}

const xmlText = (s) => String(s).replace(/&(amp|lt|gt|quot|apos);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]).trim();

async function readSitemaps(fetcher, origin, declared) {
  const host = new URL(origin).hostname;
  const mine = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && sameSite(x.hostname, host) ? x : null; } catch { return null; } };
  const queue = (declared.length ? declared : [origin + '/sitemap.xml']).slice(0, 2);
  const seen = new Set(); const urls = new Set();
  let fetched = 0, found = false, unknown = false;
  while (queue.length && fetched < MAX_SITEMAP_FETCH) {
    const u = queue.shift(); if (seen.has(u)) continue; seen.add(u); fetched++;
    const res = await fetcher(u, { maxBodyBytes: 1024 * 1024, truncate: true });
    if (!res || !res.ok) { if (!res || res.unavailable_reason !== 'content_type_rejected') unknown = true; continue; }
    if (res.status === 404 || res.status === 410) continue;
    if (res.status >= 400) { unknown = true; continue; }
    const text = res.body.toString('utf8');
    if (!/<(urlset|sitemapindex)[\s>]/i.test(text)) continue; // 없는 주소에 메인 화면을 주는 사이트
    found = true;
    const locs = [...text.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => mine(xmlText(m[1]))).filter(Boolean);
    if (/<sitemapindex[\s>]/i.test(text)) { for (const l of locs.slice(0, 6)) queue.push(l.href); }
    else for (const l of locs) { if (urls.size < MAX_SITEMAP_URLS) { l.hash = ''; urls.add(l.hostname.replace(/^www\./, '') + l.pathname + l.search); } } // 물음표 뒤가 다르면 다른 페이지
  }
  if (queue.length) unknown = unknown || !found;
  return { state: found ? 'found' : unknown ? 'unknown' : 'none', pages: urls.size, capped: urls.size >= MAX_SITEMAP_URLS };
}

async function runAudit(input, opts = {}) {
  const fetcher = opts.fetcher || safeFetch;
  const start = normalizeInput(input);
  if (!start) return { ok: false, reason: 'bad_url' };

  let home = await fetchPage(fetcher, start.href);
  if (!home.ok && start.protocol === 'https:' && ['network_error', 'timeout'].includes(home.reason)) {
    const alt = new URL(start.href); alt.protocol = 'http:';
    const h2 = await fetchPage(fetcher, alt.href);
    if (h2.ok) home = h2;
  }
  if (!home.ok) return { ok: false, reason: home.reason, status: home.status || null, host: start.hostname };

  let base = new URL(home.finalUrl);
  let scan = H.scan(home.text);
  // 첫 주소가 글자 없이 다른 화면으로 넘기기만 하는 경우(meta refresh·스크립트 이동)는 따라간다. 같은 사이트 안에서 2번까지.
  for (let hop = 0; hop < 2 && H.countChars(scan.bodyText) < 30; hop++) {
    const next = redirectTarget(scan, home.text, base);
    if (!next) break;
    const moved = await fetchPage(fetcher, next.href);
    if (!moved.ok) break;
    home = Object.assign(moved, { ms: home.ms + moved.ms });
    base = new URL(home.finalUrl); scan = H.scan(home.text);
  }
  let framed = false; let linkBase = null; let frameHeaders = null;
  // 옛 방식(frameset) 홈페이지: 첫 프레임이 실제 화면
  if (H.countChars(scan.bodyText) < 30 && scan.frames.length) {
    const f = scan.frames.find((x) => x.kind === 'frame') || scan.frames[0];
    let fu = null; try { fu = new URL(f.src, base); } catch { /* 무시 */ }
    if (fu && sameSite(fu.hostname, base.hostname)) {
      const inner = await fetchPage(fetcher, fu.href);
      if (inner.ok) {
        framed = true; const outer = scan; scan = H.scan(inner.text);
        scan.title = scan.title || outer.title; scan.metas = outer.metas.concat(scan.metas); scan.links = outer.links.concat(scan.links);
        // 링크는 안쪽 화면 주소를 기준으로 풀고, 색인 금지 헤더는 안팎을 모두 본다
        linkBase = new URL(inner.finalUrl);
        frameHeaders = inner.headers;
      }
    }
  }
  const origin = base.origin;

  const robotsP = fetcher(origin + '/robots.txt', { maxBodyBytes: 512 * 1024 }).then((res) => {
    const dec = res && res.ok ? H.decodeHtml(res.body, res.headers && res.headers['content-type']) : null;
    return R.classifyRobotsResponse(res, dec ? dec.text : '');
  }).catch(() => ({ state: 'unknown', groups: null, text: '' }));

  const want = [['doctor', RX.doctorLink], ['faq', RX.faqLink], ['info', RX.infoLink]];
  const innerP = Promise.all(want.map(async ([key, re]) => {
    const u = pickLink(scan, linkBase || base, re);
    if (!u) return [key, null];
    const p = await fetchPage(fetcher, u.href);
    return [key, p.ok ? { url: u.href, scan: H.scan(p.text) } : { url: u.href, scan: null }];
  }));

  const robots = await robotsP;
  const sitemap = await readSitemaps(fetcher, origin, R.sitemapUrls(robots.text || '').filter((u) => { try { return sameSite(new URL(u).hostname, base.hostname); } catch { return false; } }));
  const inner = Object.fromEntries(await innerP);

  const path = base.pathname + base.search;
  const doors = R.aiDoors(robots, path);
  const engines = R.searchEngines(robots, path);
  const noindex = noindexFor(scan, home.headers);
  if (frameHeaders) { const inner2 = noindexFor({ metas: [] }, frameHeaders); for (const k of Object.keys(noindex)) noindex[k] = noindex[k] || inner2[k]; }

  const scans = [scan, ...Object.values(inner).filter((x) => x && x.scan).map((x) => x.scan)];
  const sd = structured(scans);
  const allText = scans.map((s) => s.bodyText).join('\n');
  const homeText = scan.bodyText;

  const doc = inner.doctor;
  const docText = doc && doc.scan ? doc.scan.bodyText : '';
  // 전문의 표기 + 서로 다른 약력 낱말 3가지 이상이 같은 화면에 글자로 있어야 '확인'
  const careerKinds = (t) => new Set(t.match(RX.doctorCareer) || []).size;
  const doctorsVerified = (RX.doctorProof.test(docText) && careerKinds(docText) >= 3) || (RX.doctorProof.test(homeText) && careerKinds(homeText) >= 3);
  const faqScan = inner.faq && inner.faq.scan;
  // 첫 화면의 물음표 문장은 광고 문구일 수 있다. 질문 구역(제목)이나 FAQ 표시가 있을 때만 질문으로 센다.
  const homeIsFaq = sd.faq || scan.headings.some((h) => RX.faqLink.test(h.text)); // 메뉴에 FAQ 글자가 있는 것만으로는 아님
  const faqQuestions = Math.max(homeIsFaq ? questionLines(scan) : 0, faqScan ? questionLines(faqScan) : 0);

  const desc = (scan.metas.find((m) => m.name === 'description') || {}).content || '';
  const viewport = scan.metas.some((m) => m.name === 'viewport');
  const canonical = scan.links.some((l) => /\bcanonical\b/.test(l.rel) && l.href);

  return {
    ok: true, host: base.hostname.replace(/^www\./, ''), finalUrl: base.href, framed, checked_at: new Date().toISOString(),
    robots: { state: robots.state, note: robots.note || null },
    doors, engines, noindex,
    text: { chars: H.countChars(homeText), prose: proseChars(scan.lines), lines: scan.lines.slice(0, 40).map((l) => l.slice(0, 60)), images: scan.images, scripts: scan.scriptCount },
    structured: sd,
    faq: { questions: faqQuestions, schema: sd.faq, link: !!inner.faq },
    pages: { sitemap: sitemap.state, count: sitemap.pages, capped: sitemap.capped, internalLinks: internalLinkCount(scan, linkBase || base) },
    doctors: { link: !!doc, verified: !!doctorsVerified },
    basic: { phone: RX.phone.test(allText), address: RX.address.test(allText), hours: RX.hoursWord.test(allText) && RX.hoursTime.test(allText) },
    speed: { ms: home.ms, viewport },
    hygiene: { https: base.protocol === 'https:', title: scan.title.length >= 5 && !RX.genericTitle.test(scan.title.trim()), titleText: scan.title.slice(0, 80), description: desc.trim().length >= 20, canonical, sitemap: sitemap.state === 'found' },
  };
}

module.exports = { runAudit, normalizeInput, sameSite, RX };
