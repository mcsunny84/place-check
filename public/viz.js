// 플레이스 체크 — 결과 화면 시각 요소(인라인 SVG, 라이브러리 없음).
// 규칙: 막대 ≤24px·데이터 끝 4px 둥글게, 격자는 1px 실선, 글자는 본문 색(데이터 색 아님), 상태색은 라벨과 같이.
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n1 = (x) => (Math.round(x * 10) / 10).toString();
  const C = { ink: 'var(--ink)', muted: 'var(--muted)', faint: 'var(--faint)', line: 'var(--line)', track: 'var(--paper-2)', accent: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' };

  // 업종별 v2 중앙값 — 2026-11-03 라이브 138곳 시뮬레이션(docs/10). ponytail: 통계 파일에 scoreV2가 쌓이면 서버 집계로 교체
  const MEDIAN = { 요리주점: 53, 한식: 58, 중식당: 56, 이자카야: 61, 육류: 64, 양식: 69, 돈가스: 65, 곱창: 70, 일식당: 63, 카페: 66, 생선회: 52 };
  const MEDIAN_ALL = 56;
  function benchmark(category) {
    const key = String(category || '').split(',')[0].trim();
    const hit = Object.keys(MEDIAN).find((k) => key.includes(k));
    return hit ? { label: hit, median: MEDIAN[hit] } : { label: '전체', median: MEDIAN_ALL };
  }

  // 상태: 비율 → 라벨·색 (색만으로 뜻을 전하지 않는다 — 라벨 동반)
  const level = (p) => (p >= 0.8 ? { k: 'good', t: '좋음', c: C.ok } : p >= 0.5 ? { k: 'mid', t: '보통', c: C.warn } : { k: 'bad', t: '부족', c: C.bad });

  // 1) 점수 게이지: 도넛 + 큰 숫자 + 등급, 업종 중앙값 눈금
  function gauge(score, grade, bench) {
    const R = 54, cx = 70, cy = 70, cw = 10, circ = 2 * Math.PI * R;
    const p = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
    const m = bench ? Math.max(0, Math.min(100, bench.median)) / 100 : null;
    const gt = [45, 60, 75].map((g) => { const a = -Math.PI / 2 + (g / 100) * 2 * Math.PI; return `<line x1="${cx + (R + cw / 2 + 1) * Math.cos(a)}" y1="${cy + (R + cw / 2 + 1) * Math.sin(a)}" x2="${cx + (R + cw / 2 + 6) * Math.cos(a)}" y2="${cy + (R + cw / 2 + 6) * Math.sin(a)}" stroke="${C.faint}" stroke-width="1.5"><title>${g === 75 ? 'A' : g === 60 ? 'B' : 'C'}등급 ${g}점부터</title></line>`; }).join('');
    const tick = m == null ? '' : (() => { const a = -Math.PI / 2 + m * 2 * Math.PI; const x1 = cx + (R - cw) * Math.cos(a), y1 = cy + (R - cw) * Math.sin(a), x2 = cx + (R + cw) * Math.cos(a), y2 = cy + (R + cw) * Math.sin(a); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"><title>같은 업종 중간값 ${bench.median}점</title></line>`; })();
    return `<svg class="gauge" viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="점수 ${score == null ? '없음' : score + '점'}${grade ? ' ' + grade + '등급' : ''}">
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.track}" stroke-width="${cw}"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${C.accent}" stroke-width="${cw}" stroke-linecap="round" stroke-dasharray="${(p * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
${gt}${tick}
<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="40" font-weight="800" fill="${C.ink}" letter-spacing="-1">${score == null ? '—' : score}</text>
<text x="${cx}" y="${cy + 26}" text-anchor="middle" font-size="13" font-weight="700" fill="${C.muted}">${grade ? grade + '등급' : '등급 없음'}</text>
</svg>`;
  }

  // 2) 영역 막대: 라벨 | 막대 | 득점/배점 | 상태
  function axes(ax, order) {
    const rows = order.filter((a) => ax[a]).map((a) => {
      const x = ax[a]; const p = x.known ? x.earned / x.known : 0; const lv = level(p);
      return `<div class="ax"><span class="ax-l">${esc(x.label)}</span><div class="ax-bar"><i style="width:${(p * 100).toFixed(0)}%;background:${lv.c}"></i></div><span class="ax-n">${n1(x.earned)}<span class="ax-max">/${n1(x.known)}</span></span><span class="badge ${lv.k}">${lv.t}</span>${x.known < x.max ? `<span class="ax-note">확인 안 된 ${n1(x.max - x.known)}점 제외</span>` : ''}</div>`;
    }).join('');
    return `<div class="axes">${rows}</div><p class="muted" style="margin-top:8px">좋음 80%↑ · 보통 50~79% · 부족 50% 미만 (영역 배점 대비)</p>`;
  }

  // 3) 사다리: 지금 점수 → 이걸 하면 +N. 막대는 [현재 득점][올릴 수 있는 점수][배점 나머지]
  function ladder(r, top) {
    const items = new Map((r.items || []).map((i) => [i.id, i]));
    const known = Object.values(r.axes).reduce((s, x) => s + x.known, 0) || 100;
    const earned = Object.values(r.axes).reduce((s, x) => s + x.earned, 0);
    const gain = top.reduce((s, t) => s + t.lost, 0);
    const projected = Math.min(100, Math.round(((earned + gain) / known) * 100));
    let acc = earned;
    const rows = top.map((t, i) => {
      const it = items.get(t.id) || { pts: 0, max: t.lost };
      const max = it.max || t.lost; const cur = Math.max(0, it.pts || 0);
      const pc = (cur / max) * 100, pg = (Math.min(max - cur, t.lost) / max) * 100;
      acc += t.lost; const step = Math.min(100, Math.round((acc / known) * 100));
      return `<div class="lad"><div class="lad-h"><b>${i + 1}. ${esc(t.label)}</b><span class="lad-gain">+${n1(t.lost)}<small>점</small></span><span class="lad-step">→ ${step}점${step >= 75 ? ' A' : step >= 60 ? ' B' : step >= 45 ? ' C' : ''}</span></div>
<div class="lad-bar"><i class="cur" style="width:${pc.toFixed(0)}%"></i><i class="gain" style="width:${pg.toFixed(0)}%"></i></div>
<p class="muted">${esc(t.next)} <span class="ax-max">(지금 ${n1(cur)} / 배점 ${n1(max)})</span></p></div>`;
    }).join('');
    const legend = `<div class="lad-legend"><span><i class="cur"></i>지금 받은 점수</span><span><i class="gain"></i>이걸 하면 더 받는 점수</span></div>`;
    const summary = top.length ? `<div class="lad-sum"><span class="muted">지금</span><b>${r.score ?? '—'}</b><span class="arrow">→</span><span class="muted">위 ${top.length}개를 다 하면</span><b class="to">${projected}</b><span class="muted">점 안팎</span></div>` : '';
    return legend + rows + summary;
  }

  // 4) 월별 세로 막대(리뷰 수): 마지막 달·최댓값만 숫자 표시, 나머지는 툴팁
  function columns(series, opt = {}) {
    if (!series || !series.length) return '';
    const W = 560, H = 150, padL = 8, padR = 8, padT = 18, padB = 24;
    const n = series.length, max = Math.max(...series.map((d) => d.value), 1);
    const slot = (W - padL - padR) / n, bw = Math.min(24, slot * 0.6);
    const iMax = series.findIndex((d) => d.value === max);
    const bars = series.map((d, i) => {
      const h = Math.max(0, ((H - padT - padB) * d.value) / max); const x = padL + i * slot + (slot - bw) / 2, y = H - padB - h;
      const show = i === n - 1 || i === iMax;
      return `<g><title>${esc(d.label)}: ${d.value}${esc(opt.unit || '')}</title><path d="M${x} ${H - padB} v${-h + 4} a4 4 0 0 1 4 -4 h${bw - 8} a4 4 0 0 1 4 4 v${h - 4} z" fill="${i === n - 1 ? C.accent : C.ink}" fill-opacity="${i === n - 1 ? 1 : 0.55}"/>${show ? `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" font-size="12" font-weight="700" fill="${C.ink}">${d.value}</text>` : ''}<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="11" fill="${C.muted}">${esc(d.label)}</text></g>`;
    }).join('');
    return `<svg class="cols" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opt.title || '')}"><line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="${C.line}" stroke-width="1"/>${bars}</svg>${opt.note ? `<p class="muted">${esc(opt.note)}</p>` : ''}`;
  }

  // 5) 미터: 비율 하나 (답글률 등)
  function meter(pct, label, note) {
    const p = Math.max(0, Math.min(100, Math.round(pct))); const lv = level(p / 100);
    return `<div class="mt"><div class="mt-h"><span>${esc(label)}</span><b>${p}%</b><span class="badge ${lv.k}">${lv.t}</span></div><div class="ax-bar"><i style="width:${p}%;background:${lv.c}"></i></div>${note ? `<p class="muted">${esc(note)}</p>` : ''}</div>`;
  }

  // 6) 가로 막대 목록(검색량·투표 수): 값 라벨은 막대 끝, 상태 라벨 동반
  function hbars(rows, opt = {}) {
    if (!rows || !rows.length) return '';
    const max = Math.max(...rows.map((r) => r.value || 0), 1);
    return `<div class="hb">${rows.map((r) => {
      const v = r.value == null ? null : r.value; const w = v == null ? 0 : (v / max) * 100;
      return `<div class="hb-row"><span class="hb-l">${esc(r.label)}</span><div class="ax-bar"><i style="width:${w.toFixed(0)}%;background:${r.ok === false ? C.faint : C.accent}"></i></div><span class="hb-v">${v == null ? '—' : v.toLocaleString('ko-KR')}${esc(opt.unit || '')}</span>${r.tag ? `<span class="badge ${r.ok === false ? 'mute' : r.ok ? 'good' : 'mid'}">${esc(r.tag)}</span>` : '<span></span>'}${r.sub ? `<span class="hb-sub">${esc(r.sub)}</span>` : ''}</div>`;
    }).join('')}</div>`;
  }

  // 7) 주제 체크 그리드: 있음/없음
  function topics(list) {
    return `<div class="tp">${(list || []).map((t) => `<span class="tp-c ${t.covered ? 'on' : ''}">${t.covered ? '✓' : '✗'} ${esc(t.label)}</span>`).join('')}</div>`;
  }

  window.PlaceViz = { gauge, axes, ladder, columns, meter, hbars, topics, benchmark, level };
})();
