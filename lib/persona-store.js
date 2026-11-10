'use strict';
// 손님 카드 보관·기록 — 결과 7일 보관, 사건 기록(개인정보 없음), 하루 유료 분석 상한, 잠금 코드 확인.
const fs = require('node:fs');
const path = require('node:path');

const DIR = process.env.PERSONA_DIR || path.join(__dirname, '..', 'data', 'persona');
const RESULTS = path.join(DIR, 'results');
const EVENTS = path.join(DIR, 'events.jsonl');
const DAILY = path.join(DIR, 'daily.json');
const TTL_MS = 7 * 24 * 3600 * 1000;
const VERSION = 1;
const EVENTS_MAX_BYTES = 20 * 1024 * 1024;
const TYPES = ['analyze', 'view', 'unlock', 'reject'];
const CHANNELS = ['ig', 'th', 'chat', 'etc'];

const kstDate = (ms) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
const okId = (id) => /^\d{1,20}$/.test(String(id));
const resultPath = (id) => path.join(RESULTS, `${id}.json`);
const cleanVid = (x) => (typeof x === 'string' && /^[a-z0-9]{8,32}$/.test(x) ? x : null);
const cleanCh = (x) => (CHANNELS.includes(x) ? x : null);

function readResult(placeId, now = Date.now()) {
  if (!okId(placeId)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(resultPath(placeId), 'utf8'));
    const age = now - Date.parse(j.saved_at);
    return j._v === VERSION && age >= 0 && age < TTL_MS ? j : null;
  } catch { return null; }
}
// saved_at은 처음 저장 때만 찍는다(추가 분석을 채워 다시 저장해도 7일 기준은 그대로).
function writeResult(placeId, result, now = Date.now()) {
  if (!okId(placeId)) throw new Error('bad placeId');
  fs.mkdirSync(RESULTS, { recursive: true });
  const out = { ...result, _v: VERSION, saved_at: result.saved_at || new Date(now).toISOString() };
  const tmp = resultPath(placeId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, resultPath(placeId));
  return out;
}

function logEvent(ev, now = Date.now()) {
  if (!ev || !TYPES.includes(ev.type)) return;
  const s = (x, n) => (typeof x === 'string' ? x.slice(0, n) : null);
  const line = {
    ts: new Date(now).toISOString(), type: ev.type, placeId: okId(ev.placeId) ? String(ev.placeId) : null,
    name: s(ev.name, 60), category: s(ev.category, 40), district: s(ev.district, 40),
    reviews: Number.isInteger(ev.reviews) ? ev.reviews : null,
    cards: Array.isArray(ev.cards) ? ev.cards.map((c) => s(c, 30)).filter(Boolean).slice(0, 3) : null,
    status: s(ev.status, 20), vid: cleanVid(ev.vid), ch: cleanCh(ev.ch), reason: s(ev.reason, 30),
  };
  try {
    fs.mkdirSync(DIR, { recursive: true });
    let size = 0; try { size = fs.statSync(EVENTS).size; } catch { /* 없음 */ }
    if (size < EVENTS_MAX_BYTES) fs.appendFileSync(EVENTS, JSON.stringify(line) + '\n');
  } catch { /* 기록 실패 무시 */ }
}

function readDaily() { try { return JSON.parse(fs.readFileSync(DAILY, 'utf8')) || {}; } catch { return {}; } }
function dailyCount(now = Date.now()) { return readDaily()[kstDate(now)] || 0; }
// 유료 분석 1건 예약. 동기 — 호출부는 AI 호출의 첫 await 전에 불러야 한다. 상한이면 false. 돌려주지 않는다.
function reserve(now = Date.now(), max = Number(process.env.PERSONA_DAILY_MAX) || 300) {
  const d = readDaily(); const day = kstDate(now);
  if ((d[day] || 0) >= max) return false;
  const keep = Object.keys(d).sort().slice(-60); // 최근 60일만 남김
  const next = {}; for (const k of keep) next[k] = d[k];
  next[day] = (d[day] || 0) + 1;
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(DAILY, JSON.stringify(next)); } catch { return false; } // 셀 수 없으면 쓰지 않는다
  return true;
}

function codeOk(code, env = process.env) {
  const list = String((env && env.PERSONA_CODES) || '').split(',').map((x) => x.trim()).filter(Boolean);
  return typeof code === 'string' && list.includes(code.trim());
}

function aggregate() {
  let lines = [];
  try { lines = fs.readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* 없음 */ }
  const days = {}; const sets = {}; const rejects = {};
  for (const l of lines) {
    const day = kstDate(Date.parse(l.ts));
    const d = days[day] = days[day] || { analyze: 0, view: 0, unlock: 0, reject: 0, visitors: 0, unlockers: 0 };
    const s = sets[day] = sets[day] || { v: new Set(), u: new Set() };
    d[l.type] += 1;
    if (l.vid && (l.type === 'analyze' || l.type === 'view')) s.v.add(l.vid);
    if (l.vid && l.type === 'unlock') s.u.add(l.vid);
    if (l.type === 'reject') { const k = l.category || l.reason || '알 수 없음'; rejects[k] = (rejects[k] || 0) + 1; }
  }
  for (const day of Object.keys(days)) { days[day].visitors = sets[day].v.size; days[day].unlockers = sets[day].u.size; }
  const recent = lines.filter((l) => l.type === 'analyze').slice(-200).reverse();
  return { days, recent, rejects, daily: readDaily() };
}

module.exports = { DIR, TTL_MS, VERSION, readResult, writeResult, logEvent, dailyCount, reserve, codeOk, aggregate, cleanVid, cleanCh };
