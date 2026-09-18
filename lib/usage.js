'use strict';
// LLM 토큰 사용량 기록·집계 — 호출마다 한 줄(jsonl). 비용은 공식 가격표(platform.claude.com/docs/en/about-claude/pricing, 2026-09-18 확인) 기준 추정.
const fs = require('node:fs');
const path = require('node:path');
const FILE = process.env.PLACE_USAGE_FILE || path.join(__dirname, '..', 'data', 'stats', 'llm-usage.jsonl');
// USD / MTok: [입력, 출력, 캐시 읽기]
const PRICE = [
  [/sonnet-5/, [2, 10, 0.2]],
  [/opus-5|opus-4/, [5, 25, 0.5]],
  [/haiku-4/, [1, 5, 0.1]],
  [/sonnet-4/, [3, 15, 0.3]],
];
function price(model) { for (const [re, p] of PRICE) if (re.test(model)) return p; return [2, 10, 0.2]; }
function cost(model, u) {
  const [i, o, c] = price(model);
  return ((u.in || 0) * i + (u.out || 0) * o + (u.cacheRead || 0) * c) / 1e6;
}

function record(kind, model, usage) {
  if (!usage) return;
  const line = { ts: new Date().toISOString(), kind, model, in: usage.input_tokens || 0, out: usage.output_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0 };
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.appendFileSync(FILE, JSON.stringify(line) + '\n'); } catch { /* 기록 실패 무시 */ }
}

// 일별·종류별 집계 (KST 날짜)
function aggregate(file = FILE) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* 없음 */ }
  const byDay = {}, byKind = {}, total = { calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 };
  const add = (t, l) => { t.calls += 1; t.in += l.in; t.out += l.out; t.cacheRead += l.cacheRead || 0; t.cost += cost(l.model, l); };
  for (const l of lines) {
    const day = new Date(Date.parse(l.ts) + 9 * 3600000).toISOString().slice(0, 10);
    byDay[day] = byDay[day] || { calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 };
    byKind[l.kind] = byKind[l.kind] || { calls: 0, in: 0, out: 0, cacheRead: 0, cost: 0 };
    add(byDay[day], l); add(byKind[l.kind], l); add(total, l);
  }
  const round = (t) => ({ ...t, cost: Math.round(t.cost * 10000) / 10000 });
  return { total: round(total), byDay: Object.fromEntries(Object.entries(byDay).map(([k, v]) => [k, round(v)])), byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, round(v)])), since: lines.length ? lines[0].ts : null };
}

module.exports = { record, aggregate, cost, price, FILE };
