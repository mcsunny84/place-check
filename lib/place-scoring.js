/* place-scoring.js — 18문항 판정·산식 (UMD: CommonJS + window.PlaceScoring). 06번 §1·§2, 08번 계약. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlaceScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 'place-check-1.0';

  var ITEMS = [
    { id: 'A1', group: 'A', weight: 5, label: '전화번호가 등록돼 있나요' },
    { id: 'A2', group: 'A', weight: 6, label: '영업시간이 요일별로 등록돼 있나요' },
    { id: 'A3', group: 'A', weight: 3, label: '휴게 시간·정기휴무가 등록돼 있나요' },
    { id: 'A4', group: 'A', weight: 6, label: '찾아오는 길 안내문이 있나요' },
    { id: 'B1', group: 'B', weight: 7, label: '상세설명 글자 수' },
    { id: 'B2', group: 'B', weight: 8, label: '대표키워드 몇 개 등록했나요' },
    { id: 'B3', group: 'B', weight: 7, label: '메뉴가 가격과 함께 등록돼 있나요' },
    { id: 'B4', group: 'B', weight: 4, label: '메뉴판 사진 또는 메뉴 이미지가 있나요' },
    { id: 'B5', group: 'B', weight: 6, label: '등록된 사진이 몇 장인가요' },
    { id: 'B6', group: 'B', weight: 6, label: '마지막 소식(새소식) 올린 날짜' },
    { id: 'B7', group: 'B', weight: 2, label: '홈페이지·인스타 등 링크가 등록돼 있나요' },
    { id: 'C1', group: 'C', weight: 5, label: '네이버 예약을 켰나요' },
    { id: 'C2', group: 'C', weight: 4, label: '톡톡 또는 스마트콜을 켰나요' },
    { id: 'C3', group: 'C', weight: 3, label: '진행 중인 쿠폰이나 이벤트 소식이 있나요' },
    { id: 'C4', group: 'C', weight: 3, label: '편의시설·주차 정보를 등록했나요' },
    { id: 'D1', group: 'D', weight: 8, label: '가장 최근 방문자 리뷰 날짜' },
    { id: 'D2', group: 'D', weight: 10, label: '가장 최근 사장님 답글 날짜' },
    { id: 'D3', group: 'D', weight: 7, label: '상세설명·소식 원문 위험 표현 검사' }
  ];

  // 주의 표현 사전 (v0.4 §2.1: 강요·점수 지정·허위 유도·효능 단정·보장)
  var DANGER = [
    { pattern: /별\s*(점|5\s*개|다섯\s*개)\s*(부탁|주세요|주시면|남겨|달아|눌러)/, label: '별점 요청' },
    { pattern: /(5|다섯)\s*(점|개)\s*(만점|부탁|주세요|주시면)/, label: '별점 요청' },
    { pattern: /(평점|별점|점수)\s*(5|다섯|만점)/, label: '점수 지정' },
    { pattern: /(리뷰|후기|평점|별점)[^\n]{0,15}(무료|할인|서비스|증정|쿠폰|사은품)/, label: '리뷰 대가 제공' },
    { pattern: /(무료|할인|서비스|증정)[^\n]{0,15}(리뷰|후기)\s*(작성|남기|써)/, label: '리뷰 대가 제공' },
    { pattern: /(리뷰|후기)[^\n]{0,10}(강요|필수|반드시|꼭\s*(써|남겨|작성))/, label: '리뷰 강요' },
    { pattern: /방문\s*(안\s*해도|하지\s*않아도|없이)[^\n]{0,10}(리뷰|후기)/, label: '허위 리뷰 유도' },
    { pattern: /(리뷰|후기)[^\n]{0,10}(대행|알바|구매)/, label: '허위 리뷰 유도' },
    { pattern: /100\s*%\s*(치료|완치|효과|효능|만족|감량)/, label: '효능 단정' },
    { pattern: /완치|부작용\s*(없|0)/, label: '효능 단정' },
    { pattern: /무조건[^\n]{0,10}(효과|효능|살\s*빠|치료|낫)/, label: '효능 단정' },
    { pattern: /(1\s*위|일등|최고|매출|효과)\s*보장|보장\s*합니다|보장\s*해\s*드/, label: '보장 표현' }
  ];

  function nfcTrim(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFC');
    return s.trim();
  }
  function textLen(s) { return Array.from(nfcTrim(s)).length; }

  function scanDanger(text) {
    var t = nfcTrim(text), out = [];
    for (var i = 0; i < DANGER.length; i++) {
      var m = DANGER[i].pattern.exec(t);
      if (m) out.push({ label: DANGER[i].label, match: m[0], index: m.index });
    }
    return out;
  }

  // 정수: trim 후 /^\d+$/ 만, 상한 9999. 아니면 null.
  function toInt(raw) {
    if (typeof raw === 'number') return Number.isInteger(raw) && raw >= 0 && raw <= 9999 ? raw : null;
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    return n <= 9999 ? n : null;
  }

  // 'YYYY-MM-DD' → UTC ms (달력일 비교용). 실제 존재하는 날짜만.
  function dateUtc(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d), dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return t;
  }

  // asOf 기준 경과 일수(달력일). 미래·형식 오류 → null.
  function daysAgo(raw, asOf) {
    var a = dateUtc(asOf), b = dateUtc(raw);
    if (a === null || b === null) return null;
    var diff = Math.round((a - b) / 86400000);
    return diff < 0 ? null : diff;
  }

  function yn(raw) { return raw === 'yes' ? 'pass' : raw === 'no' ? 'fail' : 'unknown'; }
  function tier(n, lo, hi) { return n === null ? 'unknown' : n >= hi ? 'pass' : n >= lo ? 'partial' : 'fail'; }
  // 날짜 항목: ≤pass일 pass, ≤partial일 partial, 초과 fail, 'none' fail
  function dateTier(raw, asOf, passDays, partialDays) {
    if (raw === 'none') return 'fail';
    var d = daysAgo(raw, asOf);
    return d === null ? 'unknown' : d <= passDays ? 'pass' : d <= partialDays ? 'partial' : 'fail';
  }

  var RULES = {
    A1: yn,
    A2: function (r) { return r === 'all' ? 'pass' : r === 'some' ? 'partial' : r === 'no' ? 'fail' : 'unknown'; },
    A3: function (r) { return r === 'na' ? 'na' : yn(r); },
    A4: yn,
    B1: function (r) { return tier(toInt(r), 1, 200); },
    B2: function (r) { var n = toInt(r); return n === null || n > 5 ? 'unknown' : tier(n, 1, 5); },
    B3: function (r) { return r === 'price' ? 'pass' : r === 'menu_only' ? 'partial' : r === 'none' ? 'fail' : 'unknown'; },
    B4: yn,
    B5: function (r) { return tier(toInt(r), 5, 20); },
    B6: function (r, c) { return dateTier(r, c.asOf, 30, 90); },
    B7: yn,
    C1: function (r) { return r === 'on' ? 'pass' : r === 'off' ? 'fail' : r === 'na' ? 'na' : 'unknown'; },
    C2: yn, C3: yn, C4: yn,
    D1: function (r, c) { return dateTier(r, c.asOf, 90, 180); },
    D2: function (r, c) {
      if (c.answers && c.answers.D1 === 'none') return 'na';
      return dateTier(r, c.asOf, 30, 90);
    },
    D3: function (r) {
      if (r === 'clean') return 'pass';
      if (r === 'flagged') return 'fail';
      if (!r || typeof r !== 'object' || typeof r.text !== 'string') return 'unknown';
      if (!nfcTrim(r.text)) return 'unknown';
      return scanDanger(r.text).length ? 'fail' : 'pass';
    }
  };

  function judge(id, raw, ctx) {
    var rule = RULES[id];
    if (!rule) return 'unknown';
    if (raw === undefined || raw === null) return id === 'D2' ? rule(raw, ctx || {}) : 'unknown';
    return rule(raw, ctx || {});
  }

  function computeScore(answers, opts) {
    answers = answers || {};
    var ctx = { asOf: opts && opts.asOf, answers: answers };
    var items = [], P = 0, K = 0, E = 0, groups = {};
    ITEMS.forEach(function (it) {
      var st = judge(it.id, answers[it.id], ctx), w = it.weight;
      items.push({ id: it.id, state: st, weight: w });
      var g = groups[it.group] || (groups[it.group] = { earned: 0, applicable: 0, known: 0 });
      if (st === 'na') return;
      P += w; g.applicable += w;
      if (st === 'unknown') return;
      K += w; g.known += w;
      var e = st === 'pass' ? w : st === 'partial' ? w / 2 : 0;
      E += e; g.earned += e;
    });
    var coverage = P > 0 ? K / P : 0;
    var score = K > 0 ? Math.round(100 * E / K) : null;
    var display = P === 0 ? 'insufficient' : coverage >= 0.7 ? 'score' : coverage >= 0.5 ? 'grade' : 'insufficient';
    var grade = display === 'insufficient' || score === null ? null
      : score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
    return { version: VERSION, score: score, grade: grade, coverage: coverage, display: display, groups: groups, items: items };
  }

  function pickTodos(result) {
    var list = result.items.filter(function (i) { return i.state === 'fail' || i.state === 'partial'; });
    list.sort(function (a, b) {
      if (a.id === 'D3' && a.state === 'fail') return -1;
      if (b.id === 'D3' && b.state === 'fail') return 1;
      var sa = a.weight * (a.state === 'fail' ? 1 : 0.5), sb = b.weight * (b.state === 'fail' ? 1 : 0.5);
      return sb - sa || (a.id < b.id ? -1 : 1);
    });
    return list.slice(0, 3).map(function (i) { return i.id; });
  }

  var SUPPLEMENT_ORDER = ['D1', 'D2', 'B2', 'B5', 'B6', 'C1', 'A3', 'A4', 'C3', 'C4', 'B4'];
  function pickSupplement(result) {
    var by = {};
    result.items.forEach(function (i) { by[i.id] = i.state; });
    return SUPPLEMENT_ORDER.filter(function (id) { return by[id] === 'unknown'; }).slice(0, 5);
  }

  return {
    VERSION: VERSION, ITEMS: ITEMS, DANGER: DANGER, SUPPLEMENT_ORDER: SUPPLEMENT_ORDER,
    judge: judge, computeScore: computeScore, pickTodos: pickTodos, pickSupplement: pickSupplement,
    scanDanger: scanDanger, daysAgo: daysAgo, toInt: toInt, textLen: textLen
  };
});
