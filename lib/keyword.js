// 플레이스 체크 — 대표키워드 진단·추천 (v0.4 §2.5, 06번 §2 정규화). UMD, 의존성 0.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.PlaceKeyword = f(); })(this, function () {
  'use strict';
  var compact = function (s) { return String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ''); };
  var len = function (s) { return Array.from(s).length; };

  // 업종 매핑표 [norm, suffix, aliases] — 표에 없으면 미지원(접미 '추천', 업종 검사 보류)
  var CATS = [
    ['돈카츠', '맛집', ['돈가스', '돈까스', '돈카츠']],
    ['카페', '추천', ['카페', '커피전문점', '커피', '디저트', '디저트카페']],
    ['한식', '맛집', ['한식', '한식당', '한정식']],
    ['중식', '맛집', ['중식', '중국집', '중식당', '중국요리']],
    ['일식', '맛집', ['일식', '일본음식', '일식당', '일본요리']],
    ['양식', '맛집', ['양식', '양식당']],
    ['분식', '맛집', ['분식']],
    ['치킨', '맛집', ['치킨', '치킨전문점']],
    ['피자', '맛집', ['피자', '피자전문점']],
    ['술집', '맛집', ['술집', '호프', '호프집', '이자카야', '요리주점']],
    ['고기', '맛집', ['고기', '고깃집', '고기집', '육류', '고기요리']],
    ['삼겹살', '맛집', ['삼겹살']],
    ['족발', '맛집', ['족발', '족발보쌈']],
    ['보쌈', '맛집', ['보쌈']],
    ['국밥', '맛집', ['국밥']],
    ['냉면', '맛집', ['냉면']],
    ['초밥', '맛집', ['초밥', '스시']],
    ['라멘', '맛집', ['라멘']],
    ['파스타', '맛집', ['파스타', '이탈리안', '이탈리아음식']],
    ['빵집', '맛집', ['베이커리', '빵집', '제과점']],
    ['미용실', '잘하는 곳', ['미용실', '헤어샵', '헤어살롱']],
    ['병원', '추천', ['병원']],
    ['의원', '추천', ['의원']],
    ['치과', '추천', ['치과', '치과의원']],
    ['한의원', '추천', ['한의원']],
    ['피부과', '추천', ['피부과']],
    ['학원', '추천', ['학원', '교습소']]
  ];
  function findCat(category) {
    var parts = String(category == null ? '' : category).split(/[,/·>]/);
    for (var p = 0; p < parts.length; p++) {
      var c = compact(parts[p]);
      if (!c) continue;
      for (var i = 0; i < CATS.length; i++) if (CATS[i][2].indexOf(c) >= 0) return CATS[i];
    }
    return null;
  }
  function normalizeCategory(category) {
    var g = findCat(category);
    return g ? { norm: g[0], suffix: g[1], supported: true } : { norm: String(category == null ? '' : category).trim(), suffix: '추천', supported: false };
  }

  function extractDistrict(roadAddress) {
    var s = String(roadAddress == null ? '' : roadAddress).normalize('NFC').trim();
    if (!s) return null;
    var m = s.match(/\(([^)]*)\)/);
    if (m) { var first = m[1].split(',')[0].trim(); if (/[동가리읍면]$/.test(first) && !/^\d+동$/.test(first)) return first; }
    var toks = s.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3);
    for (var i = 0; i < toks.length; i++) if (/[동읍면리]$/.test(toks[i]) && !/^\d+동$/.test(toks[i])) return toks[i];
    var wide = /(특별시|광역시|특별자치시|특별자치도|도)$/;
    for (var j = 0; j < toks.length; j++) if (/[구군]$/.test(toks[j]) && !wide.test(toks[j])) return toks[j];
    for (var k = 0; k < toks.length; k++) if (/시$/.test(toks[k]) && !wide.test(toks[k])) return toks[k];
    return null;
  }

  function stationDisplay(name) {
    var s = String(name == null ? '' : name).trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
    return !s || /역$/.test(s) ? s : s + '역';
  }

  function menuForKeyword(name) {
    var o = String(name == null ? '' : name).trim();
    var s = o.split('+')[0].replace(/\([^)]*[\/\d][^)]*\)/g, '').replace(/\(\d+인\)/g, '').replace(/\(\d+인분\)/g, '').replace(/\s*\d+인\s*세트$/, '').replace(/세트$/, '').trim();
    return len(s) < 2 ? o : s;
  }

  var REGION_SUFFIX = /(역|동|구|시|읍|면|리|사거리|거리|시장|단지)$/;
  function diagnoseKeywords(keywords, ctx) {
    ctx = ctx || {};
    if (ctx.reviewMenus && ctx.reviewMenus.length) ctx = Object.assign({}, ctx, { menus: (ctx.menus || []).concat(ctx.reviewMenus) });
    var kws = (keywords || []).map(function (k) { return String(k == null ? '' : k).normalize('NFC').trim(); });
    var cat = normalizeCategory(ctx.category), group = findCat(ctx.category);
    var regionToks = [ctx.district, ctx.district && shortDistrict(ctx.district), ctx.station, ctx.station && stationDisplay(ctx.station), ctx.station && String(ctx.station).replace(/역$/, '')]
      .map(compact).filter(function (t) { return len(t) >= 2; });
    var catToks = [cat.norm].concat(group ? group[2] : []);
    (ctx.menus || []).forEach(function (m) { catToks.push(m); catToks.push(menuForKeyword(m)); });
    catToks = catToks.map(compact).filter(function (t) { return len(t) >= 2; });
    var seen = {};
    return kws.map(function (k) {
      var c = compact(k), toks = k.split(/\s+/).filter(Boolean), labels = [];
      var hasRegion = regionToks.some(function (t) { return c.indexOf(t) >= 0; }) || toks.some(function (t) { return len(t) >= 2 && REGION_SUFFIX.test(t); });
      var hasCat = catToks.some(function (t) { return c.indexOf(t) >= 0; });
      if (len(k) < 2 || len(k) > 20) labels.push('길이 이상');
      if (c && c === compact(ctx.name)) labels.push('브랜드명 단독');
      if (seen[c]) labels.push('중복');
      seen[c] = true;
      if (!hasRegion) labels.push('지역 없음');
      if (cat.supported && !hasCat) labels.push('업종·메뉴 없음');
      if (toks.length === 1 && !(hasRegion && hasCat)) labels.push('너무 넓음');
      if (!labels.length) labels.push('좋아요');
      return { keyword: k, labels: labels };
    });
  }

  // '경주시'→'경주', '종로구'→'종로', '안국동'→'안국', '양평읍'→'양평' — 사람들이 실제로 치는 형태. 2글자(예: '중구')는 유지.
  function shortDistrict(d) {
    d = d ? String(d).trim() : '';
    if (len(d) > 2 && /(시|군|구|동|읍|면)$/.test(d)) return d.slice(0, -1);
    return d;
  }
  var GENERIC_CAT = ['양식', '한식', '중식', '일식', '음식점', '식당', '기타', '분식', '주점'];
  function recommendKeywords(ctx) {
    ctx = ctx || {};
    // 업종이 뭉뚱그려진 값(양식·한식…)이면 리뷰에서 가장 많이 언급된 메뉴 용어(예: 바베큐)를 업종으로 쓴다
    if ((!ctx.categoryNorm || GENERIC_CAT.indexOf(String(ctx.categoryNorm).trim()) >= 0) && ctx.reviewMenus && ctx.reviewMenus.length) ctx = Object.assign({}, ctx, { categoryNorm: ctx.reviewMenus[0], suffix: ctx.suffix || '맛집' });
    var d = shortDistrict(ctx.district);
    var st = ctx.station ? stationDisplay(ctx.station) : '';
    var cat = ctx.categoryNorm ? String(ctx.categoryNorm).trim() : '';
    var suf = ctx.suffix || '맛집', food = suf === '맛집';
    var menus = (ctx.menus || []).map(menuForKeyword).filter(Boolean), sit = (ctx.situations || []).filter(Boolean);
    var m1 = menus[0] || '', m2 = menus[1] || '', s1 = sit[0] || '', s2 = sit[1] || '';
    var T = [
      [d, cat], [st, cat],
      food ? [d, suf] : [d, cat, suf], food ? [st, suf] : [st, cat, suf],
      [d, m1], [st, m1], [d, s1, cat], [st, s1], [d, cat, '추천'],
      m2 ? [d, m2] : [st, s2]
    ];
    var existing = (ctx.existing || []).map(compact), seen = {}, out = [];
    T.forEach(function (parts, i) {
      if (parts.some(function (p) { return !p; })) return;
      var kw = parts.join(' '), c = compact(kw);
      if (seen[c]) return;
      seen[c] = true;
      out.push({ keyword: kw, template: i + 1, existing: existing.indexOf(c) >= 0 });
    });
    return out.slice(0, 10);
  }

  return { extractDistrict: extractDistrict, shortDistrict: shortDistrict, stationDisplay: stationDisplay, normalizeCategory: normalizeCategory, menuForKeyword: menuForKeyword, diagnoseKeywords: diagnoseKeywords, recommendKeywords: recommendKeywords };
});
