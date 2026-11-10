'use strict';
// 손님 카드 임시 그림 22종 생성기 — node scripts/persona-gen-pictures.js
// 먹선 + 미색 원 + 파란 포인트 1곳. 정식 그림(검수본)이 오면 public/persona/img/<키>.svg(또는 같은 키의 파일)를 교체한다.
const fs = require('node:fs');
const path = require('node:path');
const { ILLUSTRATION_KEYS } = require('../lib/persona');
const OUT = path.join(__dirname, '..', 'public', 'persona', 'img');
const INK = '#141414', PAPER = '#ffffff', WARM = '#f7f4ec', BLUE = '#2f5bea', GRAY = '#9a9a9a';
const r = (n) => Math.round(n * 10) / 10;

// 사람 한 명. (x, y) = 머리 중심, s = 크기 배율(1 = 머리 반지름 23)
function person(x, y, s, o = {}) {
  const R = 23 * s, sw = r(3.4 * Math.max(s, 0.62));
  const hairColor = o.gray ? GRAY : INK;
  const P = (dx, dy) => `${r(x + dx * s)} ${r(y + dy * s)}`;
  const out = [];
  // 뒷머리(긴 머리)
  if (o.hair === 'long') out.push(`<path d="M${P(-25, -2)}C${P(-30, 22)} ${P(-27, 40)} ${P(-21, 48)}L${P(21, 48)}C${P(27, 40)} ${P(30, 22)} ${P(25, -2)}z" fill="${hairColor}"/>`);
  // 몸
  out.push(`<path d="M${P(-38, 150)}L${P(-38, 70)}C${P(-36, 42)} ${P(-22, 30)} ${P(0, 30)}C${P(22, 30)} ${P(36, 42)} ${P(38, 70)}L${P(38, 150)}z" fill="${o.body || PAPER}" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  if (o.top === 'collar') out.push(`<path d="M${P(-12, 32)}L${P(0, 46)}L${P(12, 32)}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/>`);
  if (o.top === 'hood') out.push(`<path d="M${P(-15, 33)}C${P(-8, 44)} ${P(8, 44)} ${P(15, 33)}" fill="none" stroke="${INK}" stroke-width="${sw}"/><path d="M${P(-5, 42)}L${P(-5, 54)}M${P(5, 42)}L${P(5, 54)}" stroke="${BLUE}" stroke-width="${r(sw * 0.8)}" stroke-linecap="round"/>`);
  if (o.top === 'lanyard') out.push(`<path d="M${P(-12, 32)}L${P(0, 46)}L${P(12, 32)}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="M${P(-10, 34)}C${P(-6, 50)} ${P(-2, 58)} ${P(0, 62)}C${P(2, 58)} ${P(6, 50)} ${P(10, 34)}" fill="none" stroke="${BLUE}" stroke-width="${r(sw * 0.85)}"/><rect x="${r(x - 9 * s)}" y="${r(y + 56 * s)}" width="${r(18 * s)}" height="${r(12 * s)}" rx="${r(2.5 * s)}" fill="${BLUE}"/>`);
  if (o.top === 'tie') out.push(`<path d="M${P(-12, 32)}L${P(0, 44)}L${P(12, 32)}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><path d="M${P(0, 44)}L${P(-5, 62)}L${P(0, 68)}L${P(5, 62)}z" fill="${BLUE}"/>`);
  if (o.top === 'cardigan') out.push(`<path d="M${P(-10, 32)}L${P(0, 50)}L${P(10, 32)}M${P(0, 50)}L${P(0, 70)}" fill="none" stroke="${INK}" stroke-width="${sw}" stroke-linejoin="round"/><circle cx="${r(x + 5 * s)}" cy="${r(y + 58 * s)}" r="${r(2.4 * s)}" fill="${BLUE}"/>`);
  if (o.top === 'scarf') out.push(`<path d="M${P(-14, 32)}C${P(-6, 42)} ${P(6, 42)} ${P(14, 32)}L${P(12, 40)}C${P(4, 48)} ${P(-4, 48)} ${P(-12, 40)}z" fill="${BLUE}"/>`);
  if (o.top === 'strap') out.push(`<path d="M${P(-20, 36)}L${P(-12, 70)}M${P(20, 36)}L${P(12, 70)}" stroke="${BLUE}" stroke-width="${r(sw * 1.3)}" stroke-linecap="round"/>`);
  if (o.top === 'camera') out.push(`<path d="M${P(-11, 33)}L${P(0, 54)}L${P(11, 33)}" fill="none" stroke="${INK}" stroke-width="${r(sw * 0.7)}"/><rect x="${r(x - 11 * s)}" y="${r(y + 52 * s)}" width="${r(22 * s)}" height="${r(15 * s)}" rx="${r(3 * s)}" fill="${BLUE}"/><circle cx="${r(x)}" cy="${r(y + 59.5 * s)}" r="${r(4.2 * s)}" fill="${PAPER}"/>`);
  // 얼굴
  out.push(`<circle cx="${r(x)}" cy="${r(y)}" r="${r(R)}" fill="${PAPER}" stroke="${INK}" stroke-width="${sw}"/>`);
  // 앞머리
  if (o.hair === 'short') out.push(`<path d="M${P(-23, -2)}C${P(-23, -18)} ${P(-13, -27)} ${P(1, -27)}C${P(14, -27)} ${P(23, -19)} ${P(23, -5)}C${P(15, -5)} ${P(7, -9)} ${P(2, -16)}C${P(-3, -8)} ${P(-11, -3)} ${P(-23, -2)}z" fill="${hairColor}"/>`);
  if (o.hair === 'side') out.push(`<path d="M${P(-23, -3)}C${P(-23, -18)} ${P(-13, -27)} ${P(1, -27)}C${P(14, -27)} ${P(23, -19)} ${P(23, -6)}C${P(8, -7)} ${P(-6, -12)} ${P(-14, -20)}C${P(-16, -12)} ${P(-19, -6)} ${P(-23, -3)}z" fill="${hairColor}"/>`);
  if (o.hair === 'thin') out.push(`<path d="M${P(-23, -4)}C${P(-22, -14)} ${P(-17, -21)} ${P(-10, -24)}C${P(-13, -16)} ${P(-16, -9)} ${P(-23, -4)}zM${P(23, -4)}C${P(22, -14)} ${P(17, -21)} ${P(10, -24)}C${P(13, -16)} ${P(16, -9)} ${P(23, -4)}z" fill="${hairColor}"/>`);
  if (o.hair === 'long') out.push(`<path d="M${P(-23, 0)}C${P(-24, -17)} ${P(-13, -27)} ${P(0, -27)}C${P(13, -27)} ${P(24, -17)} ${P(23, 0)}C${P(18, -8)} ${P(10, -14)} ${P(0, -15)}C${P(-10, -14)} ${P(-18, -8)} ${P(-23, 0)}z" fill="${hairColor}"/>`);
  if (o.hair === 'bob') out.push(`<path d="M${P(-25, 14)}C${P(-29, -12)} ${P(-15, -28)} ${P(0, -28)}C${P(15, -28)} ${P(29, -12)} ${P(25, 14)}C${P(20, 4)} ${P(19, -6)} ${P(12, -13)}C${P(4, -9)} ${P(-10, -8)} ${P(-17, -6)}C${P(-19, 2)} ${P(-21, 9)} ${P(-25, 14)}z" fill="${hairColor}"/>`);
  if (o.hair === 'perm') { const dots = [[-21, -8], [-15, -19], [-5, -25], [6, -25], [16, -19], [22, -8], [-24, 4], [24, 4]]; out.push(dots.map(([dx, dy]) => `<circle cx="${r(x + dx * s)}" cy="${r(y + dy * s)}" r="${r(8.5 * s)}" fill="${hairColor}"/>`).join('')); out.push(`<circle cx="${r(x)}" cy="${r(y + 3 * s)}" r="${r(19 * s)}" fill="${PAPER}"/>`); }
  if (o.hair === 'tail') out.push(`<path d="M${P(-23, 0)}C${P(-24, -17)} ${P(-13, -27)} ${P(0, -27)}C${P(13, -27)} ${P(24, -17)} ${P(23, 0)}C${P(16, -10)} ${P(6, -15)} ${P(-4, -15)}C${P(-12, -13)} ${P(-19, -7)} ${P(-23, 0)}z" fill="${hairColor}"/><path d="M${P(20, -16)}C${P(34, -18)} ${P(36, -2)} ${P(29, 10)}C${P(28, 0)} ${P(25, -8)} ${P(20, -16)}z" fill="${hairColor}"/>`);
  if (o.hair === 'cap') out.push(`<path d="M${P(-24, -4)}C${P(-23, -20)} ${P(-12, -28)} ${P(0, -28)}C${P(12, -28)} ${P(23, -20)} ${P(24, -4)}z" fill="${BLUE}"/><path d="M${P(-26, -4)}L${P(34, -4)}" stroke="${INK}" stroke-width="${sw}" stroke-linecap="round"/>`);
  // 눈·입
  const ey = 5, ex = 8.5;
  out.push(`<circle cx="${r(x - ex * s)}" cy="${r(y + ey * s)}" r="${r(2.3 * s)}" fill="${INK}"/><circle cx="${r(x + ex * s)}" cy="${r(y + ey * s)}" r="${r(2.3 * s)}" fill="${INK}"/>`);
  out.push(`<path d="M${P(-6.5, 13)}C${P(-2.5, 16.5)} ${P(2.5, 16.5)} ${P(6.5, 13)}" fill="none" stroke="${INK}" stroke-width="${r(sw * 0.85)}" stroke-linecap="round"/>`);
  if (o.glasses) out.push(`<circle cx="${r(x - ex * s)}" cy="${r(y + ey * s)}" r="${r(6.3 * s)}" fill="none" stroke="${INK}" stroke-width="${r(sw * 0.6)}"/><circle cx="${r(x + ex * s)}" cy="${r(y + ey * s)}" r="${r(6.3 * s)}" fill="none" stroke="${INK}" stroke-width="${r(sw * 0.6)}"/><path d="M${P(-2.2, 5)}L${P(2.2, 5)}" stroke="${INK}" stroke-width="${r(sw * 0.6)}"/>`);
  if (o.wrinkle) out.push(`<path d="M${P(-17, 10)}C${P(-15, 13)} ${P(-15, 15)} ${P(-16, 17)}M${P(17, 10)}C${P(15, 13)} ${P(15, 15)} ${P(16, 17)}M${P(-7, -9)}L${P(7, -9)}" fill="none" stroke="${INK}" stroke-width="${r(sw * 0.45)}" stroke-linecap="round"/>`);
  if (o.blush) out.push(`<circle cx="${r(x - 15 * s)}" cy="${r(y + 11 * s)}" r="${r(3.2 * s)}" fill="${BLUE}" opacity=".28"/><circle cx="${r(x + 15 * s)}" cy="${r(y + 11 * s)}" r="${r(3.2 * s)}" fill="${BLUE}" opacity=".28"/>`);
  return out.join('');
}
const svg = (label, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="${label}"><defs><clipPath id="c"><circle cx="60" cy="60" r="58"/></clipPath></defs><circle cx="60" cy="60" r="58" fill="${WARM}"/><g clip-path="url(#c)">${body}</g></svg>\n`;
const glass = (x, y, s) => `<path d="M${r(x - 5 * s)} ${r(y)}L${r(x + 5 * s)} ${r(y)}L${r(x + 4 * s)} ${r(y + 11 * s)}L${r(x - 4 * s)} ${r(y + 11 * s)}z" fill="${BLUE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>`;

const M = { '20s': { hair: 'short', top: 'hood' }, '30s': { hair: 'short', top: 'lanyard' }, '40_50s': { hair: 'side', top: 'tie', glasses: true }, '60plus': { hair: 'thin', top: 'cardigan', gray: true, glasses: true, wrinkle: true } };
const F = { '20s': { hair: 'long', top: 'hood', blush: true }, '30s': { hair: 'bob', top: 'lanyard' }, '40_50s': { hair: 'bob', top: 'scarf', glasses: true }, '60plus': { hair: 'perm', top: 'cardigan', gray: true, glasses: true, wrinkle: true } };
const PICS = {
  'solo-neutral': ['혼자 온 손님', person(60, 50, 1, { hair: 'cap', top: 'collar' })],
  'couple-young': ['젊은 커플', person(40, 56, 0.78, { hair: 'long', top: 'hood', blush: true }) + person(81, 52, 0.82, { hair: 'short', top: 'hood' })],
  'couple-mid': ['중년 부부', person(40, 56, 0.78, { hair: 'bob', top: 'scarf', glasses: true }) + person(81, 52, 0.82, { hair: 'side', top: 'tie', glasses: true })],
  'couple-neutral': ['두 사람', person(40, 55, 0.8, { hair: 'cap', top: 'collar' }) + person(81, 55, 0.8, { hair: 'cap', top: 'collar' })],
  'family-kids': ['아이와 온 가족', person(33, 46, 0.7, { hair: 'bob', top: 'collar' }) + person(87, 44, 0.72, { hair: 'short', top: 'collar' }) + person(60, 78, 0.52, { hair: 'tail', top: 'strap', blush: true })],
  'family-parents': ['부모님을 모신 가족', person(31, 50, 0.66, { hair: 'perm', top: 'cardigan', gray: true, glasses: true, wrinkle: true }) + person(89, 50, 0.66, { hair: 'thin', top: 'cardigan', gray: true, wrinkle: true }) + person(60, 64, 0.72, { hair: 'short', top: 'lanyard' })],
  'friends-f': ['친구 모임(여)', person(30, 54, 0.64, { hair: 'long', top: 'hood' }) + person(90, 54, 0.64, { hair: 'tail', top: 'collar' }) + person(60, 62, 0.72, { hair: 'bob', top: 'scarf', blush: true })],
  'friends-m': ['친구 모임(남)', person(30, 54, 0.64, { hair: 'short', top: 'hood' }) + person(90, 54, 0.64, { hair: 'side', top: 'collar' }) + person(60, 62, 0.72, { hair: 'short', top: 'strap' })],
  'friends-mixed': ['친구 모임', person(30, 54, 0.64, { hair: 'long', top: 'collar' }) + person(90, 54, 0.64, { hair: 'short', top: 'hood' }) + person(60, 62, 0.72, { hair: 'bob', top: 'scarf' })],
  'coworkers': ['직장 동료', person(30, 54, 0.64, { hair: 'bob', top: 'lanyard' }) + person(90, 54, 0.64, { hair: 'side', top: 'lanyard', glasses: true }) + person(60, 62, 0.72, { hair: 'short', top: 'lanyard' })],
  'company-dinner': ['회식 단체', person(22, 50, 0.52, { hair: 'side', top: 'tie', glasses: true }) + person(98, 50, 0.52, { hair: 'bob', top: 'collar' }) + person(45, 62, 0.6, { hair: 'short', top: 'tie' }) + person(76, 62, 0.6, { hair: 'long', top: 'collar' }) + glass(60, 96, 1.1)],
  'tourist-solo': ['혼자 온 여행자', person(60, 50, 1, { hair: 'cap', top: 'camera' })],
  'tourist-group': ['여행 온 일행', person(40, 56, 0.78, { hair: 'cap', top: 'camera' }) + person(81, 52, 0.82, { hair: 'long', top: 'strap' })],
  'students': ['학생들', person(30, 56, 0.64, { hair: 'tail', top: 'strap', blush: true }) + person(90, 56, 0.64, { hair: 'short', top: 'strap' }) + person(60, 64, 0.72, { hair: 'short', top: 'strap', glasses: true })],
};
for (const [age, o] of Object.entries(M)) PICS[`solo-m-${age}`] = [`혼자 온 남자 손님 ${age}`, person(60, 50, 1, o)];
for (const [age, o] of Object.entries(F)) PICS[`solo-f-${age}`] = [`혼자 온 여자 손님 ${age}`, person(60, 50, 1, o)];

fs.mkdirSync(OUT, { recursive: true });
for (const key of ILLUSTRATION_KEYS) {
  if (!PICS[key]) throw new Error('그림 없음: ' + key);
  fs.writeFileSync(path.join(OUT, key + '.svg'), svg(PICS[key][0], PICS[key][1]));
}
// 한눈에 보기(검수용)
fs.writeFileSync(path.join(OUT, '_all.html'), `<!doctype html><meta charset="utf-8"><title>손님 그림 22종</title><body style="font:14px sans-serif;display:grid;grid-template-columns:repeat(6,150px);gap:14px;padding:20px;background:#fff">${ILLUSTRATION_KEYS.map((k) => `<figure style="margin:0;text-align:center"><img src="${k}.svg" width="140" height="140"><figcaption>${k}</figcaption></figure>`).join('')}</body>\n`);
console.log('wrote', ILLUSTRATION_KEYS.length, 'pictures to', OUT);
