'use strict';
// 쿠폰 백데이터 집계 보기: node stats.js  (로컬 .env의 ADMIN_TOKEN 사용, 운영 서버에 질의)
const fs = require('node:fs');
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
const base = process.env.PLACE_URL || 'https://placecheck.duckdns.org';
fetch(`${base}/api/stats/coupons?token=${encodeURIComponent(env.ADMIN_TOKEN || '')}`).then((r) => r.json()).then((s) => {
  console.log(`매장 ${s.stores}곳 (기록 ${s.records}건) · 쿠폰 있음 ${s.withCoupon} · 알림받기 쿠폰 ${s.withNotification} · 멤버십 ${s.withMembership}`);
  console.log('쿠폰 종류별 매장 수:', s.byKind);
  console.log('업종별:', s.byCategory);
  console.log('많이 쓰는 쿠폰 제목:'); for (const t of s.topTitles) console.log(`  ${t.n}  ${t.title}`);
}).catch((e) => console.error('실패:', e.message));
