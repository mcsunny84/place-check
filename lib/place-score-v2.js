'use strict';
// 플레이스 점수 v2 (시험판, 라이브 미연결) — v1(채움 18항목)은 잘 운영하는 가게가 전부 만점이라 변별이 안 된다(139곳 중앙값 89).
// v2는 "있냐"에 더해 "얼마나 잘하냐"를 단계로 본다. 항목마다 근거(why)와 다음 단계까지 오를 점수(next)를 함께 낸다.
// 배점은 시안 — 분석 매장 분포(scripts/sim-v2.js)로 보정한 뒤 확정. LLM 결과는 쓰지 않는다(규칙·수집값만).
const S = require('./place-scoring');
const K = require('./keyword');
const DA = require('./draft-analysis');
const { factsToAnswers } = require('./facts-to-answers');

const VERSION = 'place-check-2.0-draft';
const v = (o) => (o && o.status === 'value' ? o.value : null);
const known = (o) => !!o && (o.status === 'value' || o.status === 'empty');

// 서버 buildResponseUncached와 같은 지역·업종 문맥(키워드·설명 판정용)
function buildContext(facts) {
  const gu = K.extractDistrict(v(facts.roadAddress) || '');
  const district = K.extractDistrict(v(facts.jibunAddress) || '') || gu;
  const areas = gu && gu !== district ? [gu] : [];
  const station = (v(facts.subwayStations) || [])[0] || null;
  const cat = K.normalizeCategory(v(facts.category) || '');
  const menus = v(facts.menus) || [];
  const recMenus = [...menus].sort((a, b) => (b.recommend === true) - (a.recommend === true) || a.order - b.order);
  const kwMenus = [...new Set(recMenus.map((m) => K.menuForKeyword(m.name)).filter(Boolean))].slice(0, 2);
  const reviewMenus = ((v(facts.reviewStats) || {}).menus || []).slice(0, 5).map((m) => m.name).filter((n) => n && n.length >= 2 && !/^(고기|맥주|생맥주|술|밥|물|음식)$/.test(n));
  const existing = v(facts.keywords) || [];
  return { name: v(facts.name), district, areas, station, category: v(facts.category) || '', cat, menus: kwMenus, reviewMenus, existing };
}

// 단계 점수: steps = [[기준, 점수], ...] 오름차순. 다음 단계 기준·점수도 돌려준다.
function ladder(x, steps) {
  let pts = 0, next = steps[0];
  for (let i = 0; i < steps.length; i++) {
    if (x >= steps[i][0]) { pts = steps[i][1]; next = steps[i + 1] || null; }
  }
  return { pts, next };
}
const round1 = (n) => Math.round(n * 10) / 10;
const daysBetween = (a, b) => { const x = S.daysAgo(a, b); return x === null ? null : x; };

function score(facts, opts = {}) {
  facts = facts || {};
  const asOf = opts.asOf;
  const ctx = opts.ctx || buildContext(facts);
  const volumes = opts.volumes !== undefined ? opts.volumes : (facts.keywords_volume || null);
  const { auto } = factsToAnswers(facts, { asOf });
  const items = [];
  // max 배점, pts 득점(null = 확인 불가 → 분모 제외), why 근거, next 다음 단계 안내
  const add = (axis, id, label, max, pts, why, next) => items.push({ axis, id, label, max, pts: pts === null ? null : round1(Math.min(max, Math.max(0, pts))), why, next: next || null });
  const st = (id) => (auto[id] ? auto[id].state : 'unknown');
  const v1pts = (id, max) => { const s = st(id); return s === 'pass' ? max : s === 'partial' ? max / 2 : s === 'fail' ? 0 : s === 'na' ? max : null; };

  // 1) 기본 정보 5 — v1 채움 항목 중 품질 단계가 없는 것. 138곳 중 96%가 만점이라(11-03 시뮬) 10→5
  add('basic', 'A1', '전화번호', 1, v1pts('A1', 1), `v1 판정 ${st('A1')}`);
  add('basic', 'A2', '요일별 영업시간', 1.5, v1pts('A2', 1.5), `v1 판정 ${st('A2')}`);
  add('basic', 'A3', '휴게·정기휴무', 0.5, v1pts('A3', 0.5), `v1 판정 ${st('A3')}`);
  add('basic', 'A4', '찾아오는 길 안내문', 1, v1pts('A4', 1), `v1 판정 ${st('A4')}`, st('A4') === 'fail' ? '찾아오는 길을 쓰면 +1' : null);
  add('basic', 'C4', '편의시설·주차', 1, v1pts('C4', 1), `v1 판정 ${st('C4')}`);

  // 2) 리뷰 30
  const reviews = v(facts.reviews);
  const total = v(facts.visitorReviewsTotal);
  {
    const recent30 = Array.isArray(reviews) ? reviews.filter((r) => { const d = daysBetween(r.visited || r.created, asOf); return d !== null && d <= 30; }).length : null;
    const L = recent30 === null ? null : ladder(recent30, [[3, 1], [10, 3], [30, 5], [60, 7], [100, 8]]);
    add('review', 'R1', '최근 30일 방문자 리뷰 수', 8, L && L.pts, recent30 === null ? '리뷰 탭 미수집' : `최근 30일 ${recent30}건`, L && L.next ? `30일 ${L.next[0]}건이면 ${L.next[1]}점(+${L.next[1] - L.pts})` : null);
  }
  {
    const L = typeof total === 'number' ? ladder(total, [[10, 1], [50, 2], [200, 3], [500, 4], [1000, 5], [2000, 6]]) : null;
    add('review', 'R2', '누적 방문자 리뷰', 6, L && L.pts, typeof total === 'number' ? `누적 ${total}건` : '미확인', L && L.next ? `누적 ${L.next[0]}건이면 +${L.next[1] - L.pts}` : null);
  }
  {
    const bodies = Array.isArray(reviews) ? reviews.filter((r) => typeof r.body === 'string') : [];
    const n = bodies.length;
    // '구체적' 리뷰: 본문 50자 이상(메뉴·상황이 들어갈 만한 길이). 은코치 신논현 기준 구체적 46%.
    const specific = bodies.filter((r) => Array.from(r.body.trim()).length >= 50).length;
    const share = n ? specific / n : null;
    add('review', 'R3', '리뷰 내용 구체성(50자 이상 비율)', 8, n >= 10 ? 8 * Math.min(1, share / 0.6) : null,
      n >= 10 ? `본문 있는 ${n}건 중 ${specific}건(${Math.round(100 * share)}%)` : '본문 10건 미만 — 판정 보류',
      n >= 10 && share < 0.6 ? '사진·메뉴명·방문 상황을 적어 달라는 영수증 리뷰 안내문으로 60%까지 올리면 만점' : null);
  }
  {
    // 답글: 최근 6개월(수집 창) 답글률 × 응답 속도
    const list = Array.isArray(reviews) ? reviews : null;
    if (total === 0) add('review', 'R4', '사장님 답글(6개월 답글률·속도)', 8, null, '리뷰 없음');
    else if (!list || list.length < 5) add('review', 'R4', '사장님 답글(6개월 답글률·속도)', 8, null, '최근 리뷰 5건 미만 — 판정 보류');
    else {
      const replied = list.filter((r) => r.hasReply);
      const rate = replied.length / list.length;
      const lags = replied.map((r) => (r.replyCreated && (r.created || r.visited)) ? daysBetween(r.created || r.visited, r.replyCreated) : null).filter((x) => x !== null).sort((a, b) => a - b);
      const med = lags.length ? lags[Math.floor(lags.length / 2)] : null;
      const speed = med === null ? 1 : med <= 3 ? 1 : med <= 7 ? 0.8 : 0.6;
      const pts = 8 * rate * speed;
      add('review', 'R4', '사장님 답글(6개월 답글률·속도)', 8, pts,
        `최근 ${list.length}건 중 답글 ${replied.length}건(${Math.round(100 * rate)}%)${med !== null ? `, 답글까지 중앙 ${med}일` : ''}`,
        rate < 0.9 ? `밀린 ${list.length - replied.length}건에 답글을 달면 최대 +${round1(8 * speed - pts)}` : med !== null && med > 3 ? '3일 안에 답글을 달면 만점' : null);
    }
  }

  // 3) 상세설명 15
  const dObs = facts.description;
  if (!known(dObs)) add('desc', 'T0', '상세설명', 17, null, 'information 탭 미수집');
  else {
    const text = v(dObs) || '';
    const an = DA.analyzeDescription(text, facts, { district: ctx.district, station: ctx.station, categoryNorm: ctx.cat.norm, reviewMenus: ctx.reviewMenus, existing: ctx.existing });
    const L = ladder(an.length, [[1, 0.5], [150, 1.5], [300, 2.5], [500, 3]]);
    add('desc', 'T1', '분량', 3, L.pts, `${an.length}자`, L.next ? `${L.next[0]}자 이상이면 +${L.next[1] - L.pts}` : null);
    const practical = ['menu', 'hours', 'parking', 'booking', 'takeout', 'road'];
    const covered = an.topics.filter((t) => practical.includes(t.key) && t.covered);
    const miss = an.topics.filter((t) => practical.includes(t.key) && !t.covered).map((t) => t.label);
    add('desc', 'T2', '손님 질문 미리 답하기(메뉴·시간·주차·예약·포장·길)', 6, 6 * covered.length / practical.length,
      `${covered.length}/6 주제`, miss.length ? `빠진 주제: ${miss.join(', ')} — 하나당 +1` : null);
    const qa = an.topics.find((t) => t.key === 'qa').covered;
    add('desc', 'T3', 'Q&A 형식', 3, qa ? 3 : 0, qa ? 'Q/A 묶음 있음' : 'Q/A 묶음 없음', qa ? null : '"Q. … / A. …" 3~5개를 넣으면 +3');
    add('desc', 'T4', '지역명·업종어', 3, (an.regionHit ? 1.5 : 0) + (an.catHit ? 1.5 : 0),
      `지역 ${an.regionHit ? '있음' : '없음'}, 업종·메뉴 ${an.catHit ? '있음' : '없음'}`, !an.regionHit || !an.catHit ? '첫 문장에 지역명+업종어를 넣으면 최대 +3' : null);
    const kh = an.keywordsInText.length;
    add('desc', 'T5', '대표키워드가 본문에 들어감', 2, kh >= 2 ? 2 : kh === 1 ? 1 : 0, `${kh}개 포함`, kh < 2 ? '대표키워드 2개를 문장에 자연스럽게 넣으면 만점' : null);
    if (an.danger.length) add('desc', 'T6', '주의 표현', 0, 0, `주의 표현 ${an.danger.map((d) => d.match).join(', ')}`, '주의 표현을 빼야 감점 해제');
  }

  // 4) 최신성 10 — 소식 빈도(90일) + 마지막 소식
  {
    const fo = facts.feeds;
    const feeds = v(fo);
    if (!Array.isArray(feeds) && !(fo && fo.status === 'empty')) add('fresh', 'F1', '소식 빈도(최근 90일)', 7, null, 'feed 탭 미수집');
    else {
      const list = Array.isArray(feeds) ? feeds : [];
      const ages = list.map((f) => S.daysAgo(f && f.createdAt, asOf)).filter((d) => d !== null);
      const n90 = ages.filter((d) => d <= 90).length;
      const L = ladder(n90, [[1, 2], [2, 4], [3, 6], [6, 7]]);
      add('fresh', 'F1', '소식 빈도(최근 90일)', 7, L.pts, `최근 90일 소식 ${n90}건`, L.next ? `90일 ${L.next[0]}건이면 +${L.next[1] - L.pts}(월 1회 이상 기준)` : null);
      const newest = ages.length ? Math.min(...ages) : null;
      const p = newest === null ? 0 : newest <= 14 ? 3 : newest <= 30 ? 2 : newest <= 60 ? 1 : 0;
      add('fresh', 'F2', '마지막 소식', 3, p, newest === null ? '소식 없음' : `${newest}일 전`, p < 3 ? '2주 안에 소식을 올리면 만점' : null);
    }
  }

  // 5) 대표키워드 18 — 칸마다 3.6점: 규칙 통과 1.8 + 월 검색량 1.8(100 이상 만점, 30 이상 절반)
  {
    const kws = ctx.existing;
    if (!known(facts.keywords)) add('keyword', 'K1', '대표키워드 품질', 18, null, '미확인');
    else {
      const diag = K.diagnoseKeywords(kws, ctx).slice(0, 5);
      const vol = (k) => (volumes && volumes[k] && volumes[k].total != null ? volumes[k].total : null);
      const haveVol = !!volumes;
      let pts = 0;
      const notes = diag.map((d) => {
        const good = d.labels.length === 1 && d.labels[0] === '좋아요';
        const vv = vol(d.keyword);
        const vp = haveVol ? (vv >= 100 ? 1.8 : vv >= 30 ? 0.9 : 0) : (good ? 1.8 : 0); // 검색량 없으면 규칙 결과로 대신
        pts += (good ? 1.8 : 0) + vp;
        return `${d.keyword}(${good ? '규칙 통과' : d.labels.join('·')}${vv !== null ? `, 월 ${vv}` : ''})`;
      });
      const empty = 5 - diag.length;
      add('keyword', 'K1', '대표키워드 품질(칸당 규칙 1.8 + 검색량 1.8)', 18, pts,
        `${diag.length}/5칸: ${notes.join(', ') || '없음'}${haveVol ? '' : ' — 검색량 미조회, 규칙으로 대신'}`,
        empty ? `빈 칸 ${empty}개를 지역+업종 조합으로 채우면 칸당 최대 +3.6` : pts < 18 ? '지역 없음·검색량 30 미만 키워드를 바꾸면 칸당 최대 +3.6' : null);
    }
  }

  // 6) 사진·메뉴 10
  {
    const t = v(facts.totalImages);
    const L = typeof t === 'number' ? ladder(t, [[5, 1], [20, 2], [50, 3], [100, 4], [200, 5], [500, 6]]) : null;
    add('media', 'M1', '사진 수', 6, L && L.pts, typeof t === 'number' ? `${t}장` : '미확인', L && L.next ? `${L.next[0]}장이면 +${L.next[1] - L.pts}` : null);
    const mo = facts.menus, menus = v(mo);
    if (Array.isArray(menus) && menus.length) {
      const withImg = menus.filter((m) => m && v(m.images) > 0).length;
      const priced = menus.filter((m) => m && v(m.price) != null && v(m.price) !== '').length;
      add('media', 'M2', '사진 있는 메뉴 비율', 2, 2 * withImg / menus.length, `${menus.length}개 중 ${withImg}개`, withImg < menus.length ? `메뉴 사진 ${menus.length - withImg}개를 더 올리면 최대 +${round1(2 - 2 * withImg / menus.length)}` : null);
      add('media', 'M3', '가격 있는 메뉴 비율', 2, 2 * priced / menus.length, `${menus.length}개 중 ${priced}개`, priced < menus.length ? '가격 없는 메뉴에 가격을 넣으면 만점' : null);
    } else if (mo && mo.status === 'empty' || Array.isArray(menus)) {
      add('media', 'M2', '사진 있는 메뉴 비율', 2, 0, '메뉴 없음', '메뉴를 사진과 함께 등록하면 +2');
      add('media', 'M3', '가격 있는 메뉴 비율', 2, 0, '메뉴 없음', '메뉴를 가격과 함께 등록하면 +2');
    } else {
      add('media', 'M2', '사진 있는 메뉴 비율', 2, null, '메뉴 미확인');
      add('media', 'M3', '가격 있는 메뉴 비율', 2, null, '메뉴 미확인');
    }
  }

  // 7) 손님 행동 장치 10 — 예약·문의·쿠폰·링크
  add('convert', 'C1', '네이버 예약', 3, v1pts('C1', 3), `v1 판정 ${st('C1')}`, st('C1') === 'fail' ? '네이버 예약을 켜면 +3' : null);
  add('convert', 'C2', '톡톡·스마트콜', 2, v1pts('C2', 2), `v1 판정 ${st('C2')}`, st('C2') === 'fail' ? '톡톡을 켜면 +2' : null);
  {
    const c = v(facts.coupons);
    if (!c) add('convert', 'C3', '쿠폰(알림받기 조건 가점)', 4, v1pts('C3', 2), `쿠폰 목록 미수집 — v1 판정 ${st('C3')}로 대신(최대 2)`);
    else {
      const n = c.coupons.length, notify = c.coupons.some((x) => x.kind === '알림받기');
      add('convert', 'C3', '쿠폰(알림받기 조건 가점)', 4, (n ? 2 : 0) + (notify ? 2 : 0), `쿠폰 ${n}개${notify ? ', 알림받기 있음' : ''}`,
        !n ? '알림받기 쿠폰을 만들면 +4' : !notify ? '알림받기 조건 쿠폰을 더하면 +2' : null);
    }
  }
  add('convert', 'B7', '홈페이지·SNS 링크', 1, v1pts('B7', 1), `v1 판정 ${st('B7')}`);

  // 합산: 확인된 항목만 분모(v1과 같은 원칙), 확인 비율도 같이 낸다
  const AXES = { basic: '기본 정보', review: '리뷰', desc: '상세설명', fresh: '최신성', keyword: '대표키워드', media: '사진·메뉴', convert: '손님 행동 장치' };
  const axes = {};
  let E = 0, Kn = 0, P = 0;
  for (const it of items) {
    const a = axes[it.axis] || (axes[it.axis] = { label: AXES[it.axis], earned: 0, known: 0, max: 0 });
    a.max += it.max; P += it.max;
    if (it.pts === null) continue;
    a.earned += it.pts; a.known += it.max; E += it.pts; Kn += it.max;
  }
  for (const a of Object.values(axes)) { a.earned = round1(a.earned); a.score = a.known ? Math.round(100 * a.earned / a.known) : null; }
  const coverage = P ? Kn / P : 0;
  const total100 = Kn ? Math.round(100 * E / Kn) : null;
  const grade = total100 === null || coverage < 0.7 ? null : total100 >= 80 ? 'A' : total100 >= 65 ? 'B' : total100 >= 45 ? 'C' : 'D';
  // 사다리: 잃은 점수가 큰 순 — "이걸 하면 +M점"
  const todos = items.filter((it) => it.pts !== null && it.next && it.max - it.pts >= 0.5)
    .map((it) => ({ id: it.id, label: it.label, lost: round1(it.max - it.pts), next: it.next }))
    .sort((a, b) => b.lost - a.lost);
  return { version: VERSION, score: total100, grade, coverage: Math.round(coverage * 100) / 100, axes, items, todos };
}

module.exports = { VERSION, score, buildContext, ladder };
