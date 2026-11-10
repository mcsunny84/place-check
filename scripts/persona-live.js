'use strict';
// 손님 카드 실전 시험 — 실제 네이버·실제 AI로 여러 매장을 차례로 돌리고, 결과가 원문과 맞는지 따로 다시 검사한다.
//
//   node scripts/persona-live.js 목록.txt [--out 결과폴더] [--dry] [--discover "성수 카페,서면 술집" --per 2]
//
//   목록.txt 한 줄: 주소 | 기대(ok·not_food·bad·any, 생략하면 any) | 메모
//   --dry       AI 없이 수집·업종 판정·리뷰 수만 본다(키 없이 가능, 비용 0)
//   --discover  검색어마다 네이버 목록에서 --per 곳을 골라 목록에 덧붙인다(불특정 매장)
//
// 운영 자료를 건드리지 않게 캐시·보관·기록은 전부 임시 폴더에 둔다. 네이버 호출 간격은 서버의 큐를 그대로 쓴다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? (args.splice(i, 1), true) : false; };
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const DRY = flag('--dry');
const OUT = opt('--out') || path.join(process.cwd(), 'persona-live-out');
const DISCOVER = (opt('--discover') || '').split(',').map((x) => x.trim()).filter(Boolean);
const PER = Number(opt('--per')) || 2;
const LIST = args[0];
if (!LIST && !DISCOVER.length) { console.error('사용법: node scripts/persona-live.js 목록.txt [--out 폴더] [--dry] [--discover "검색어,검색어" --per 2]'); process.exit(2); }

const TMP = path.join(os.tmpdir(), 'place-check-persona-live');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.PLACE_CACHE_DIR = path.join(TMP, 'cache');
process.env.PLACE_STATS_FILE = path.join(TMP, 'cache', 'coupons.jsonl');
process.env.PERSONA_DIR = path.join(TMP, 'persona');
process.env.PLACE_USAGE_FILE = path.join(TMP, 'usage.jsonl');
process.env.PERSONA_CODES = '4821';
process.env.PERSONA_DAILY_MAX = '200';
fs.mkdirSync(process.env.PLACE_CACHE_DIR, { recursive: true });
const srv = require('../server'); // .env를 읽는다(ANTHROPIC_API_KEY)
const PS = require('../lib/persona');
const RK = require('../lib/rank-check');
const U = require('../lib/usage');
if (DRY) srv.state.llmPersona = null;
else if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY가 없습니다. place-check/.env에 넣거나 --dry로 수집만 시험하세요.'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const VID = 'livetest00000001';
let base = '';
async function post(route, body) {
  const t = Date.now();
  try {
    const r = await fetch(base + '/api/persona/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* 깨진 응답 */ }
    return { code: r.status, json, text, ms: Date.now() - t };
  } catch (e) { return { code: 0, json: null, text: String(e && e.message), ms: Date.now() - t }; }
}

// 검색어 → 네이버 목록 상위 30곳 중 무작위 PER곳
async function discover(spec) {
  const m = /^(hairshop|hospital|place|accommodation):(.+)$/.exec(spec); // "hairshop:강남역 미용실"처럼 쓰면 비외식 목록에서 고른다(기대 not_food)
  const type = m ? m[1] : 'restaurant'; const keyword = m ? m[2] : spec;
  const res = await fetch(`https://pcmap.place.naver.com/${type}/list?${new URLSearchParams({ query: keyword, display: '100' })}`, { headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9' }, signal: AbortSignal.timeout(15000) });
  const st = RK.extractApollo(await res.text());
  const rq = st && st.ROOT_QUERY; if (!rq) return [];
  const key = Object.keys(rq).filter((k) => rq[k] && rq[k].businesses && Array.isArray(rq[k].businesses.items)).sort((a, b) => rq[b].businesses.items.length - rq[a].businesses.items.length)[0];
  if (!key) return [];
  const items = rq[key].businesses.items.map((r) => (r && r.__ref ? st[r.__ref] : r) || {}).filter((it) => /^\d+$/.test(String(it.id))).slice(0, 30);
  const picked = [];
  while (picked.length < PER && items.length) picked.push(items.splice(Math.floor(Math.random() * items.length), 1)[0]);
  return picked.map((it) => ({ url: `https://m.place.naver.com/${type}/${it.id}/home`, expect: m ? 'not_food' : 'any', memo: `검색 "${keyword}" → ${it.name}` }));
}

// 응답을 서버 검증과 별개로 다시 본다. 문제 목록(빈 배열이면 통과).
function audit(placeId, locked, open) {
  const bad = []; const facts = srv.readCache(placeId);
  const reviews = facts ? PS.selectReviews(facts) : [];
  const flat = (s) => String(s || '').replace(/\s+/g, '');
  const bodies = reviews.map((r) => flat(r.body));
  const stats = facts && facts.reviewStats && facts.reviewStats.status === 'value' ? facts.reviewStats.value : {};
  const voted = new Set((stats.votedKeywords || []).map((k) => flat(k.name)));
  const walk = (x) => (typeof x === 'string' ? [x] : x && typeof x === 'object' ? Object.values(x).flatMap(walk) : []);
  const cards = (open && open.cards) || [];
  if (cards.length < 1 || cards.length > 3) bad.push(`카드 ${cards.length}장`);
  if (open.confidence === 'thin' && cards.length > 2) bad.push('근거 부족인데 3장');
  if (open.review_count !== reviews.length) bad.push(`분모 ${open.review_count} ≠ 다시 센 ${reviews.length}`);
  let sum = 0;
  cards.forEach((c, i) => {
    const tag = `카드${i + 1}`;
    sum += c.count;
    if (!(c.count >= 3 && c.count <= reviews.length)) bad.push(`${tag} 건수 ${c.count}`);
    if (!PS.ILLUSTRATION_KEYS.includes(c.picture)) bad.push(`${tag} 그림 ${c.picture}`);
    for (const s of c.signals || []) if (!(s.count >= 1 && s.count <= c.count)) bad.push(`${tag} 막대 ${s.label} ${s.count}/${c.count}`);
    for (const d of c.dislikes || []) if (d.count !== null && !(d.count >= 1 && d.count <= c.count)) bad.push(`${tag} 불만 ${d.text} ${d.count}`);
    for (const q of c.quotes || []) if (!bodies.some((b) => b.includes(flat(q.text)))) bad.push(`${tag} 인용이 원문에 없음: ${q.text}`);
    if (c.menu && !PS.menuList(facts).some((m) => m.name === c.menu)) bad.push(`${tag} 메뉴판에 없는 메뉴 ${c.menu}`);
  });
  if (sum > reviews.length) bad.push(`카드 건수 합 ${sum} > 리뷰 ${reviews.length}`);
  for (const s of walk(open)) if (PS.hasPii(s)) bad.push(`개인정보 꼴 문자열: ${s.slice(0, 40)}`);
  // 잠긴 응답에 2번째 카드부터의 본문·추가 분석이 실리지 않았는가
  const lockedText = JSON.stringify(locked);
  if (cards.length > 1) { if (!locked.locked) bad.push('잠금 표시 없음'); cards.slice(1).forEach((c, i) => { if (c.scene && lockedText.includes(JSON.stringify(c.scene).slice(1, -1))) bad.push(`잠긴 응답에 카드${i + 2} 본문 노출`); }); }
  if (locked.extras) bad.push('잠긴 응답에 추가 분석 노출');
  if (open.extras) {
    for (const p of open.extras.phrases || []) if (!voted.has(flat(p)) && !bodies.some((b) => b.includes(flat(p)))) bad.push(`원문에 없는 표현: ${p}`);
    for (const c of open.extras.copy || []) if (!cards.some((x) => x.rank === c.persona)) bad.push(`없는 손님 번호의 문구 ${c.persona}`);
  }
  return bad;
}

async function runOne(item) {
  const row = { ...item, placeId: null, name: null, category: null, reviews: null, confidence: null, status: null, cards: 0, neutral: 0, extras: null, ms: {}, problems: [], http: [] };
  let c;
  for (let tries = 0; tries < 6; tries++) { // 수집은 접속 주소당 분당 3회 — 걸리면 기다렸다 다시
    c = await post('collect', { url: item.url, vid: VID, ch: 'etc' });
    if (c.json && ['ip_limit', 'slow_down'].includes(c.json.reason)) { await sleep(22000); continue; }
    break;
  }
  row.ms.collect = c.ms; row.http.push(c.code);
  if (!c.json) { row.status = 'http_error'; row.problems.push(`collect 응답 깨짐(${c.code}): ${c.text.slice(0, 80)}`); return row; }
  if (!c.json.ok) { row.status = c.json.reason; row.category = c.json.category || null; return row; }
  Object.assign(row, { placeId: c.json.placeId, name: c.json.name, category: c.json.category, reviews: c.json.review_count, confidence: c.json.confidence });
  if ((c.json.peeks || []).some((p) => p.length > 60 || PS.hasPii(p))) row.problems.push('미리보기 길이·개인정보');
  if (DRY) { row.status = c.json.confidence === 'too_few' ? 'too_few' : 'collected'; return row; }
  let a;
  for (let tries = 0; tries < 6; tries++) {
    a = await post('analyze', { placeId: row.placeId, vid: VID, ch: 'etc' });
    if (a.code === 429 || (a.json && a.json.status === 'busy')) { await sleep(15000); continue; }
    break;
  }
  row.ms.analyze = a.ms; row.http.push(a.code);
  if (!a.json) { row.status = 'http_error'; row.problems.push(`analyze 응답 깨짐(${a.code})`); return row; }
  row.status = a.json.status;
  if (a.json.status !== 'ok') return row;
  if ((await post('unlock', { placeId: row.placeId, code: '0000', vid: VID })).json.reason !== 'bad_code') row.problems.push('틀린 코드가 통과');
  const t0 = Date.now(); let u;
  for (;;) {
    u = await post('unlock', { placeId: row.placeId, code: '4821', vid: VID });
    if (!u.json || !u.json.ok) { row.problems.push(`unlock 실패(${u.code}) ${u.text.slice(0, 80)}`); return row; }
    if (u.json.extras_status !== 'pending' || Date.now() - t0 > 200000) break;
    await sleep(3000);
  }
  row.ms.extras = Date.now() - t0;
  row.extras = u.json.extras_status;
  if (u.json.extras_status === 'pending') row.problems.push('추가 분석이 200초 넘게 pending');
  row.cards = u.json.cards.length;
  row.neutral = u.json.cards.filter((x) => /neutral/.test(x.picture) || x.group === 'unknown').length;
  row.detail = u.json.cards.map((x) => ({ nickname: x.nickname, group: x.group, gender: x.gender, age: x.age, picture: x.picture, count: x.count, signals: x.signals, dislikes: x.dislikes, quotes: x.quotes.length, menu: x.menu, spend: x.spend }));
  row.problems.push(...audit(row.placeId, a.json, u.json));
  // 다시 조회: 보관 결과가 바로 나와야 하고 AI를 더 부르지 않아야 한다
  const before = U.aggregate().total.calls;
  const again = await post('analyze', { placeId: row.placeId, vid: VID, ch: 'etc' });
  if (!again.json || again.json.status !== 'ok' || again.ms > 3000) row.problems.push(`재조회 이상(${again.ms}ms)`);
  if (U.aggregate().total.calls !== before) row.problems.push('재조회가 AI를 다시 부름');
  return row;
}

(async () => {
  const items = [];
  if (LIST) for (const line of fs.readFileSync(LIST, 'utf8').split(/\r?\n/)) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const [url, expect, memo] = s.split('|').map((x) => x.trim());
    items.push({ url, expect: expect || 'any', memo: memo || '' });
  }
  for (const kw of DISCOVER) {
    try { items.push(...(await discover(kw))); } catch (e) { console.error(`검색 "${kw}" 실패:`, e.message); }
    await sleep(2500);
  }
  const server = srv.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + server.address().port;
  fs.mkdirSync(OUT, { recursive: true });
  const rows = []; const started = Date.now();
  for (const [i, item] of items.entries()) {
    const row = await runOne(item).catch((e) => ({ ...item, status: 'script_error', problems: [String(e && e.stack || e)], ms: {}, http: [] }));
    // 기대와 대조: ok=카드가 나와야 함(리뷰 부족은 허용), not_food=업종 거절, bad=주소 오류
    const want = item.expect;
    const got = row.status;
    const okStates = DRY ? ['collected', 'too_few'] : ['ok', 'too_few'];
    if (want === 'ok' && !okStates.includes(got)) row.problems.push(`기대 ok, 실제 ${got}`);
    if (want === 'not_food' && got !== 'not_food') row.problems.push(`기대 not_food, 실제 ${got}`);
    if (want === 'bad' && !['no_url', 'unsupported', 'unreadable'].includes(got)) row.problems.push(`기대 주소 오류, 실제 ${got}`);
    if (['http_error', 'script_error'].includes(got) || row.http.includes(500)) row.problems.push('서버 오류');
    rows.push(row);
    console.log(`${String(i + 1).padStart(2)}/${items.length} ${got.padEnd(11)} ${String(row.name || item.url).slice(0, 28).padEnd(28)} 리뷰 ${row.reviews ?? '-'} 카드 ${row.cards || 0} ${row.problems.length ? '⚠ ' + row.problems.join(' / ') : ''}`);
    fs.writeFileSync(path.join(OUT, 'rows.json'), JSON.stringify(rows, null, 1));
    if (srv.state.cooldownUntil > Date.now()) { console.error('네이버가 막아 쉬는 중 — 시험을 멈춥니다.'); break; }
  }
  server.close();
  const usage = U.aggregate().total; const done = rows.filter((r) => r.status === 'ok');
  const avg = (k) => { const xs = done.map((r) => r.ms[k]).filter(Number.isFinite); return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 100) / 10 : null; };
  const cardsAll = done.flatMap((r) => r.detail || []);
  const summary = {
    when: new Date().toISOString(), dry: DRY, model: PS.MODEL, total: rows.length,
    byStatus: rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {}),
    withProblems: rows.filter((r) => r.problems.length).length,
    seconds: { collect: avg('collect'), analyze: avg('analyze'), extras: avg('extras') },
    cards: { total: cardsAll.length, genderKnown: cardsAll.filter((c) => c.gender !== 'unknown').length, ageKnown: cardsAll.filter((c) => c.age !== 'unknown').length, groupKnown: cardsAll.filter((c) => c.group !== 'unknown').length, withDislike: cardsAll.filter((c) => c.dislikes.length).length, withMenu: cardsAll.filter((c) => c.menu).length },
    cost: { calls: usage.calls, usd: usage.cost, perPlaceUsd: done.length ? Math.round((usage.cost / done.length) * 10000) / 10000 : null },
    minutes: Math.round((Date.now() - started) / 6000) / 10,
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  const md = ['# 손님 카드 실전 시험', '', '```json', JSON.stringify(summary, null, 1), '```', '', '| # | 상태 | 매장 | 업종 | 리뷰 | 근거 | 카드 | 추가 | 수집·분석(초) | 문제 | 메모 |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${r.status} | ${r.name || r.url} | ${r.category || ''} | ${r.reviews ?? ''} | ${r.confidence || ''} | ${r.cards || ''} | ${r.extras || ''} | ${[r.ms.collect, r.ms.analyze].filter(Number.isFinite).map((x) => Math.round(x / 1000)).join('·')} | ${r.problems.join('<br>') || '없음'} | ${r.memo || ''} |`),
    '', '## 카드', '', ...done.flatMap((r) => [`**${r.name}** (${r.category})`, ...(r.detail || []).map((c) => `- ${c.nickname} — ${c.group}/${c.gender}/${c.age} · ${c.picture} · ${c.count}건 · 막대 ${c.signals.map((s) => `${s.label} ${s.count}`).join(', ')} · 불만 ${c.dislikes.map((d) => `${d.text} ${d.count}`).join(', ') || '없음'} · 인용 ${c.quotes} · ${c.menu || '메뉴 없음'} ${c.spend || ''}`), ''])].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), md);
  console.log('\n' + JSON.stringify(summary, null, 1) + `\n결과: ${OUT}`);
  process.exit(summary.withProblems ? 1 : 0);
})();
