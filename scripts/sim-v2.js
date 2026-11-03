#!/usr/bin/env node
'use strict';
// 점수 v2 오프라인 시뮬레이션 — 캐시된 facts(data/cache/*.json)로 v1·v2를 나란히 계산. 네트워크·LLM 호출 없음.
// 사용: node scripts/sim-v2.js [캐시 폴더=data/cache] [출력 CSV=data/sim-v2.csv]
// 기준일은 매장별 수집일(fetched_at, KST) — 오래된 캐시도 수집 당시 기준으로 채점한다.
const fs = require('fs');
const path = require('path');
const S = require('../lib/place-scoring');
const V2 = require('../lib/place-score-v2');
const { factsToAnswers } = require('../lib/facts-to-answers');

const dir = process.argv[2] || path.join(__dirname, '..', 'data', 'cache');
const out = process.argv[3] || path.join(__dirname, '..', 'data', 'sim-v2.csv');
const v = (o) => (o && o.status === 'value' ? o.value : null);
const kst = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const csv = (x) => (x === null || x === undefined ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));

const AX = ['basic', 'review', 'desc', 'fresh', 'keyword', 'media', 'convert'];
const rows = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
  let facts;
  try { facts = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
  if (!facts || !facts.fetched_at) continue;
  const asOf = kst(facts.fetched_at);
  // 구캐시(_schema < 3)는 새 메뉴 구조(placeMenus)를 못 읽어 메뉴가 비어 보인다 → 0점이 아니라 미확인으로
  const mv = v(facts.menus);
  if ((facts._schema || 0) < 3 && (!Array.isArray(mv) || !mv.length)) facts.menus = { status: 'missing' };
  try {
    const { answers } = factsToAnswers(facts, { asOf });
    const r1 = S.computeScore(answers, { asOf });
    const r2 = V2.score(facts, { asOf });
    rows.push({ placeId: v(facts.placeId) || f.replace(/\.json$/, ''), name: v(facts.name), category: v(facts.category), schema: facts._schema, asOf, v1: r1.score, v2: r2.score, grade2: r2.grade, coverage2: r2.coverage,
      ...Object.fromEntries(AX.map((a) => [a, r2.axes[a] ? r2.axes[a].score : null])), top3: r2.todos.slice(0, 3).map((t) => `${t.label} +${t.lost}`).join(' / ') });
  } catch (e) { console.error(`[skip] ${f}: ${e.message}`); }
}

const head = ['placeId', 'name', 'category', 'schema', 'asOf', 'v1', 'v2', 'grade2', 'coverage2', ...AX, 'top3'];
fs.writeFileSync(out, '﻿' + [head.join(','), ...rows.map((r) => head.map((h) => csv(r[h])).join(','))].join('\n'));

const q = (arr, p) => { const s = arr.filter((x) => x !== null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const dist = (key) => { const a = rows.map((r) => r[key]); return `min ${q(a, 0)} / p25 ${q(a, 0.25)} / 중앙 ${q(a, 0.5)} / p75 ${q(a, 0.75)} / max ${q(a, 1)}`; };
const band = (key) => { const b = {}; for (const r of rows) if (r[key] !== null) { const k = Math.min(9, Math.floor(r[key] / 10)) * 10; b[k] = (b[k] || 0) + 1; } return Object.keys(b).sort((a, c) => a - c).map((k) => `${k}대 ${b[k]}`).join(', '); };
console.log(`매장 ${rows.length}곳 → ${out}`);
console.log(`v1: ${dist('v1')}\n    ${band('v1')}`);
console.log(`v2: ${dist('v2')}\n    ${band('v2')}`);
for (const a of AX) console.log(`  ${a.padEnd(8)} ${dist(a)}`);
const sorted = rows.filter((r) => r.v2 !== null).sort((a, b) => b.v2 - a.v2);
const line = (r) => `  ${r.v2} (v1 ${r.v1}) ${r.name} [${r.category}]`;
console.log('상위 5:\n' + sorted.slice(0, 5).map(line).join('\n'));
console.log('하위 5:\n' + sorted.slice(-5).map(line).join('\n'));
console.log('v2 등급: ' + ['A', 'B', 'C', 'D'].map((g) => `${g} ${rows.filter((r) => r.grade2 === g).length}`).join(' / '));
console.log(`확인 비율 0.7 미만(등급 없음): ${rows.filter((r) => r.coverage2 < 0.7).length}곳`);
