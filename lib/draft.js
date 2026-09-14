// 플레이스 체크 — GEO용 Q&A식 상세설명 초안 (v0.4 §2.6, 04번 §4). UMD, 의존성 0.
(function (root, f) { if (typeof module === 'object' && module.exports) module.exports = f(); else root.PlaceDraft = f(); })(this, function () {
  'use strict';
  var PAIRS = { '은는': ['은', '는'], '을를': ['을', '를'], '이가': ['이', '가'] };
  function particle(word, kind) {
    var p = PAIRS[kind] || PAIRS['은는'], s = String(word == null ? '' : word).trim();
    s = s.replace(/(\s*\([^)]*\))+\s*$/, '').replace(/[\s.!?\])]+$/, ''); // 끝 괄호 그룹·문장부호 무시
    var code = s ? s.charCodeAt(s.length - 1) : 0;
    if (code < 0xAC00 || code > 0xD7A3) return p[0];
    return (code - 0xAC00) % 28 !== 0 ? p[0] : p[1];
  }
  var station = function (s) { s = String(s).trim().replace(/\s*\([^)]*\)\s*$/, ''); return /역$/.test(s) ? s : s + '역'; };
  var sent = function (s) { s = String(s).trim(); return /[.!?]$/.test(s) ? s : s + '.'; };
  function price(p) {
    if (p == null || p === '') return '';
    var s = String(p).trim();
    return /^\d+$/.test(s) ? s.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원' : s;
  }
  function buildDraft(input) {
    var i = input || {}, name = String(i.name || '').trim(), cat = String(i.categoryNorm || '').trim();
    var st = i.station ? station(i.station) : '', d = String(i.district || '').trim();
    var menus = (i.menus || []).filter(function (m) { return m && m.name; });
    var blocks = [];
    var loc = st && d ? st + ' 인근 ' + d : (st ? st + ' 인근' : d);
    var intro = name + particle(name, '은는') + (loc ? ' ' + loc + '에 있는' : '') + (cat ? ' ' + cat + ' 전문점입니다.' : ' 가게입니다.');
    if (menus.length) intro += ' 대표 메뉴는 ' + menus.slice(0, 2).map(function (m) { var p = price(m.price); return m.name + (p ? '(' + p + ')' : ''); }).join(', ') + '입니다.';
    blocks.push(intro);
    if ((d || st) && cat && menus[0]) {
      var a = name + particle(name, '은는') + ' ' + menus[0].name + particle(menus[0].name, '을를') + ' 제공합니다.';
      if (i.hours) a += ' 영업시간은 ' + String(i.hours).trim() + '입니다.';
      if (i.closed) a += ' 휴무는 ' + String(i.closed).trim() + '입니다.';
      blocks.push('Q. ' + (d || st) + '에서 ' + cat + ' 어디가 좋아요?\nA. ' + a);
    }
    if (i.parking) blocks.push('Q. 주차 되나요?\nA. ' + sent(i.parking));
    if (i.booking === 'naver') blocks.push('Q. 예약 가능한가요?\nA. 네이버 예약으로 예약할 수 있어요.');
    else if (i.booking === 'phone' && i.phone) blocks.push('Q. 예약 가능한가요?\nA. 전화(' + String(i.phone).trim() + ')로 문의해 주세요.');
    var td = [];
    if (typeof i.takeout === 'boolean') td.push(i.takeout ? '포장은 가능합니다.' : '포장은 하지 않습니다.');
    if (typeof i.delivery === 'boolean') td.push(i.delivery ? '배달도 가능합니다.' : '배달은 하지 않습니다.');
    if (td.length) blocks.push('Q. 포장이나 배달 되나요?\nA. ' + td.join(' '));
    if (i.group === true) blocks.push('Q. 단체도 되나요?\nA. 단체 이용도 가능합니다. 인원이 많으면 미리 연락 주세요.');
    if (i.accessor) blocks.push('Q. ' + (st ? st + '에서 어떻게 가요?' : '어떻게 찾아가요?') + '\nA. ' + sent(i.accessor));
    if (i.brag) blocks.push(sent(i.brag));
    return blocks.join('\n\n');
  }
  return { particle: particle, buildDraft: buildDraft };
});
