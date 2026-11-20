'use strict';
// 병원 AI 검색 점검 v2 — 화면 동작. 서버가 준 글자는 전부 textContent 로만 넣는다.
// 흐름: 병원 이름 검색 → 고르기 → 지역·진료과 확인 → 챗GPT 실측 + 구글 지도 (+ 홈페이지가 있으면 재료 점검)
(function () {
  var OPENCHAT = 'https://open.kakao.com/o/svWyvDXi';
  var BASE = location.pathname === '/hospital' || location.pathname.indexOf('/hospital/') === 0 ? '/hospital/' : '/';
  var $ = function (id) { return document.getElementById(id); };
  var NL = String.fromCharCode(10);
  var current = null;   // 지금 보이는 실측 결과(예시는 null)
  var home = null;      // 홈페이지 재료 점검 결과
  var picked = null;    // { name, address, category, url }

  // 지어낸 예시(A·B·C… 병원). 실제 병원 이름을 쓰지 않는다.
  var SAMPLE = {
    sample: true, name: '라온피부과의원',
    gpt: { asked: 5, hits: 1, dept: '피부과', regions: ['○○동', '○○역'], measured_at: null,
      rows: [
        { q: '○○동 피부과 추천해줘', state: 'missing', others: ['A피부과의원', 'B피부과의원', 'C피부과'] },
        { q: '○○동 리프팅 잘하는 곳 알려줘', state: 'missing', others: ['A피부과의원', 'D의원'] },
        { q: '○○동 야간 진료하는 피부과 알려줘', state: 'found', rank: 2, others: ['B피부과의원', 'E피부과'] },
        { q: '○○역 피부과 추천해줘', state: 'missing', others: ['A피부과의원', 'B피부과의원', 'C피부과'] },
        { q: '○○역 여드름 치료 잘하는 곳 알려줘', state: 'missing', others: ['C피부과', 'A피부과의원'] }],
      rivals: [{ name: 'A피부과의원', n: 4 }, { name: 'B피부과의원', n: 3 }, { name: 'C피부과', n: 3 }, { name: 'D의원', n: 1 }],
      sources: [{ kind: '병원 홈페이지', n: 6 }, { kind: '모두닥', n: 3 }, { kind: '닥터나우', n: 2 }, { kind: '네이버 블로그', n: 1 }], ourSourceUsed: false, homeKnown: true,
      intro: { q: '○○동 라온피부과의원 어때?', homeCited: false, unknown: false, others: ['A피부과의원'],
        text: '라온피부과의원은 ○○역 근처 피부과예요. 후기에서는 친절한 상담과 깔끔한 시설이 자주 언급돼요. 다만 피부과 전문의가 진료하는지는 공개된 자료에서 확인되지 않았어요. 대표 시술이나 가격 정보도 찾기 어려워요. 리프팅이 목적이라면 근처의 A피부과의원도 함께 비교해 보세요.',
        marks: ['다만 피부과 전문의가 진료하는지는 공개된 자료에서 확인되지 않았어요.', '대표 시술이나 가격 정보도 찾기 어려워요.'],
        gaps: [{ topic: '전문의·의료진' }, { topic: '가격·비용' }, { topic: '대표 시술·진료' }],
        sources: [{ kind: '모두닥' }, { kind: '네이버 블로그' }] },
      compare: { oursTop: false, ours: { hits: 1, cited: { n: 0, kinds: [] } }, rival: { name: 'A피부과의원', hits: 4, cited: { n: 6, kinds: [{ kind: '홈페이지', n: 4 }, { kind: '유튜브', n: 2 }] } } } },
    rivalMap: { ok: true, found: true, name: 'A피부과의원', shownName: 'A Dermatology Clinic', enChecked: true, category: 'unverifiable', hangul: false, inName: true, reviews: 205 },
    map: { ok: true, found: true, name: '라온의원', shownName: 'raon clinic', enChecked: true, label: '의사', category: 'unverifiable', hangul: false, inName: false, rating: 4.9, reviews: 812 }
  };

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
  function show(id, on) { $(id).hidden = !on; }
  function num(n) { return Number(n).toLocaleString('ko-KR'); }
  function toast(m) { var t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4500); }
  function post(path, body) {
    return fetch('/api/hospital/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, reason: r.status === 429 ? 'slow_down' : 'error' }; }); })
      .catch(function () { return { ok: false, reason: 'offline' }; });
  }

  // ---------- 입력 ----------
  var waitTimer = null;
  function waiting(on, steps) {
    show('wait', on); $('go').disabled = on; $('run').disabled = on;
    clearInterval(waitTimer);
    if (!on) return;
    var i = 0; $('waittext').textContent = steps[0];
    waitTimer = setInterval(function () { i = Math.min(i + 1, steps.length - 1); $('waittext').textContent = steps[i]; }, 4000);
  }
  function note(title, text) {
    var n = clear($('note'));
    if (!title && !text) { n.hidden = true; return; }
    if (title) n.appendChild(el('b', '', title));
    if (text) n.appendChild(document.createTextNode(text));
    n.hidden = false;
  }
  var MSG = {
    slow_down: ['잠시 뒤에 다시 해 주세요', '짧은 시간에 여러 번 점검해서 잠깐 멈췄어요. 1분 뒤에 다시 눌러 주세요.'],
    busy: ['지금 점검이 몰려 있어요', '1분 뒤에 다시 눌러 주세요.'],
    cooldown: ['지금은 병원 이름 검색이 어려워요', '잠시 뒤에 다시 해 주시거나, 아래에서 상담을 신청해 주시면 대신 재서 알려 드려요.'],
    unreadable: ['병원 이름 검색 결과를 읽지 못했어요', '잠시 뒤에 다시 해 주세요.'],
    too_short: ['두 글자 이상 적어 주세요', ''],
    too_long: ['조금 짧게 적어 주세요', '병원 이름만 적어 주세요.'],
    no_dept: ['진료과를 알아보지 못했어요', '진료과 칸에 "피부과", "치과"처럼 적어 주세요.'],
    no_region: ['질문할 지역을 적어 주세요', '예: 노원, 홍대, 서면'],
    budget: ['오늘 무료 점검 접수가 마감됐어요', '아래에서 상담을 신청해 주시면 저희가 직접 재서 결과를 알려 드려요.'],
    api: ['챗GPT 검색에 지금 연결되지 않았어요', '잠시 뒤에 다시 눌러 주세요. 결과를 지어내지 않으려고 멈췄어요.'],
    offline: ['연결이 끊겼어요', '인터넷 연결을 확인하고 다시 눌러 주세요.'],
    error: ['점검 중에 문제가 생겼어요', '잠시 뒤에 다시 눌러 주세요.']
  };
  function fail(reason) { var m = MSG[reason] || MSG.error; note(m[0], m[1]); if (reason === 'budget' || reason === 'cooldown') openCall(); }

  // 네이버 지번 주소에서 지역 이름 두 개(서버 규칙과 같게)
  function regionsOf(addr) {
    var t = String(addr || '').split('·')[0].trim().split(/\s+/); if (t.length < 2) return [];
    var r1 = null, r2 = null, metro = /^(서울|부산|대구|인천|광주|대전|울산|세종)/.test(t[0]), shortGu = /^(중|동|서|남|북)구$/;
    if (metro) { if (/구$/.test(t[1])) r1 = shortGu.test(t[1]) ? t[0].replace(/(특별|광역)?시$/, '') + ' ' + t[1] : t[1].replace(/구$/, ''); else if (/군$/.test(t[1])) r1 = t[1]; }
    else { if (/시$/.test(t[1])) r1 = t[1].replace(/시$/, ''); if (t[2] && /구$/.test(t[2]) && !shortGu.test(t[2])) r1 = t[2].replace(/구$/, ''); else if (/군$/.test(t[1])) r1 = t[1]; }
    for (var i = 1; i < t.length; i++) if (/^[가-힣]+\d*(동|읍|면|가)$/.test(t[i]) && !/구$|시$|군$/.test(t[i])) { r2 = t[i].replace(/\d+동$/, '동'); break; }
    return [r1, r2].filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  }
  var DEPTS = [[/치과/, '치과'], [/피부/, '피부과'], [/성형/, '성형외과'], [/안과/, '안과'], [/한의/, '한의원'], [/정형/, '정형외과'], [/산부인과|여성의원/, '산부인과'], [/이비인후/, '이비인후과'], [/비뇨/, '비뇨의학과'], [/통증/, '통증의학과']];
  function deptOf(c) { for (var i = 0; i < DEPTS.length; i++) if (DEPTS[i][0].test(c || '')) return DEPTS[i][1]; return ''; }

  function runSearch(q) {
    note(); show('cands', false); show('setup', false);
    waiting(true, ['병원을 찾는 중이에요']);
    post('search', { q: q }).then(function (r) {
      waiting(false);
      if (!r.ok) return fail(r.reason);
      if (!r.items.length) return note('병원을 찾지 못했어요', '네이버 플레이스에 올라 있는 이름으로 적어 주세요.');
      var box = clear($('cands'));
      box.appendChild(el('p', '', '이 병원이 맞나요? 하나를 골라 주세요.'));
      r.items.forEach(function (it) {
        var b = el('button'); b.type = 'button';
        var left = el('span'); left.appendChild(el('b', '', it.name)); if (it.category) left.appendChild(document.createTextNode(' · ' + it.category));
        b.appendChild(left); b.appendChild(el('small', '', it.address || ''));
        b.addEventListener('click', function () { choose(it); });
        box.appendChild(b);
      });
      box.hidden = false;
    });
  }
  function preview() {
    var r1 = $('r1').value.trim() || '○○', d = $('dp').value.trim() || '진료과';
    $('sq').textContent = '이런 질문을 해요: "' + r1 + ' ' + d + ' 추천해줘", "' + r1 + ' 야간 진료하는 ' + d + ' 알려줘" 외 3개';
  }
  function choose(it) {
    show('cands', false); note();
    picked = { id: it.id, name: it.name, address: it.address || '', category: it.category || '', url: null };
    var rg = regionsOf(it.address);
    $('sname').textContent = it.name + (it.category ? ' · ' + it.category : '');
    $('r1').value = rg[0] || ''; $('r2').value = rg[1] || ''; $('dp').value = deptOf(it.category);
    preview(); show('setup', true);
    // 홈페이지 주소는 미리 찾아 둔다(없어도 실측은 한다). 실측 버튼은 이 답을 기다렸다가 쓴다
    var mine = picked;
    mine.urlJob = post('pick', { id: it.id }).then(function (r) { if (r.ok) mine.url = r.url; }, function () { /* 홈페이지 없이 진행 */ });
  }
  ['r1', 'r2', 'dp'].forEach(function (id) { $(id).addEventListener('input', preview); });

  function runProbe() {
    if (!picked) return;
    var regions = [$('r1').value.trim(), $('r2').value.trim()].filter(Boolean);
    if (!regions.length) { fail('no_region'); return $('r1').focus(); }
    note();
    waiting(true, ['챗GPT에 질문 5개를 보내는 중이에요', '답에서 병원 이름을 찾는 중이에요', '구글 지도를 확인하는 중이에요', '같이 나온 병원을 세는 중이에요', '거의 다 됐어요. 30초쯤 걸려요']);
    home = null;
    var cur = picked, dept = $('dp').value.trim();
    var homeJob;
    (cur.urlJob || Promise.resolve()).then(function () {
      homeJob = cur.url ? post('check', { url: cur.url }) : Promise.resolve(null);
      return post('probe', { name: cur.name, address: cur.address, category: cur.category, dept: dept, regions: regions, host: cur.url || '' });
    }).then(function (r) {
      if (!r.ok) { waiting(false); return fail(r.reason); }
      return homeJob.then(function (h) {
        waiting(false); show('setup', false);
        home = h && h.ok ? h.result : null;
        render({ name: cur.name, gpt: r.gpt, map: r.map, rivalMap: r.rivalMap, token: r.token }, false);
        try { history.replaceState(null, '', BASE + 'r/' + r.token); } catch (e) { /* 무시 */ }
        $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
  $('run').addEventListener('click', runProbe);
  $('ask').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.replace(/\s+/g, ' ').trim();
    if (!q) { $('q').focus(); return; }
    if (/^https?:\/\//i.test(q) || /^www\./i.test(q)) return note('병원 이름으로 찾아 주세요', '챗GPT 추천을 재려면 병원 이름이 필요해요. 홈페이지 점검도 함께 해 드려요.');
    runSearch(q);
  });
  $('again').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); $('q').value = ''; $('q').focus(); });

  // ---------- 결과 ----------
  function plain(md) {
    return String(md || '').replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '')
      .replace(/^\|?-{2,}.*$/gm, '').replace(/\|/g, ' ').replace(/^#+\s*/gm, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, NL + NL).trim();
  }
  function verdict(g) {
    if (!g.hits) return '질문 ' + g.asked + '개 모두에서 챗GPT가 우리 병원을 추천하지 않았어요.';
    if (g.hits === g.asked) return '질문 ' + g.asked + '개 모두에서 챗GPT가 우리 병원을 추천했어요.';
    return '질문 ' + g.asked + '개 중 ' + g.hits + '개에서 챗GPT가 우리 병원을 추천했어요. 나머지 ' + (g.asked - g.hits) + '개에서는 다른 병원이 나왔어요.';
  }
  function drawQuestions(g) {
    var box = clear($('qlist'));
    g.rows.forEach(function (r) {
      var q = el('div', 'q'); var h = el('div', 'qh');
      h.appendChild(el('b', '', '"' + r.q + '"'));
      h.appendChild(el('span', 'pill2 ' + r.state, r.state === 'found' ? (r.rank ? r.rank + '번째로 나옴' : '나옴') : r.state === 'missing' ? '빠짐' : '못 물어봄'));
      q.appendChild(h);
      if (r.state === 'missing' && r.others && r.others.length) q.appendChild(el('p', 'inst', '대신 나온 곳: ' + r.others.join(', ')));
      if (r.state === 'found' && r.others && r.others.length) q.appendChild(el('p', 'inst', '함께 나온 곳: ' + r.others.join(', ')));
      if (r.text) {
        var d = el('details'); d.appendChild(el('summary', '', '챗GPT 답 그대로 보기'));
        d.appendChild(el('div', 'ans', plain(r.text)));
        if (r.sources && r.sources.length) {
          var ul = el('ul', 'srcs');
          r.sources.forEach(function (s) { var li = el('li'); li.appendChild(el('em', '', s.kind)); li.appendChild(el('span', '', s.title || s.url)); ul.appendChild(li); });
          d.appendChild(ul);
        }
        q.appendChild(d);
      }
      box.appendChild(q);
    });
  }
  function drawRivals(g, name) {
    var box = clear($('rivals'));
    var list = g.rivals.slice(0, 5).map(function (x) { return { name: x.name, n: x.n, me: false }; });
    list.push({ name: name + ' (우리)', n: g.hits, me: true });
    list.sort(function (a, b) { return b.n - a.n || (a.me ? 1 : -1); });
    list.forEach(function (x) {
      var row = el('div', 'rv' + (x.me ? ' me' : ''));
      row.appendChild(el('b', '', x.name)); row.appendChild(el('span', '', x.n + ' / ' + g.asked));
      var bar = el('i'); bar.style.setProperty('--w', Math.round(100 * x.n / Math.max(1, g.asked)) + '%'); row.appendChild(bar);
      box.appendChild(row);
    });
    var top = g.rivals[0];
    $('rivalsay').textContent = top ? top.name + '은(는) 질문 ' + g.asked + '개 중 ' + top.n + '개에 나왔어요. 상담에서는 이 병원들과 우리 병원을 AI가 쓰는 재료 기준으로 나란히 놓고 비교해 드려요.' : '답에서 병원 이름을 뽑지 못했어요.';
    show('rivalsec', g.rivals.length > 0);
  }
  function drawSources(g, hasHome) {
    var box = clear($('chips'));
    g.sources.slice(0, 10).forEach(function (s) { var c = el('span', 'chip' + (s.kind === '우리 홈페이지' ? ' us' : ''), s.kind); c.appendChild(el('b', '', String(s.n))); box.appendChild(c); });
    $('srcsay').textContent = !hasHome ? '챗GPT는 답을 쓸 때 아래 사이트를 근거로 댔어요.'
      : g.ourSourceUsed ? '우리 홈페이지도 근거로 쓰였어요. 아래는 답 전체에 붙은 출처를 종류별로 센 거예요.'
        : '우리 홈페이지는 한 번도 근거로 쓰이지 않았어요. 챗GPT는 아래 사이트에서 병원 정보를 가져갔어요.';
    show('srcsec', g.sources.length > 0);
  }
  function check(cls, mark, title, why) { var li = el('li'); li.appendChild(el('strong', cls, mark)); li.appendChild(el('span', '', title)); if (why) li.appendChild(el('small', '', why)); return li; }
  function drawMap(m, dept) {
    var box = clear($('mapcard'));
    if (!m || !m.ok) {
      box.appendChild(el('h3', '', '지금은 구글 지도를 확인하지 못했어요'));
      box.appendChild(el('p', 'meta', '상담에서 직접 확인해 드려요.'));
      return;
    }
    if (!m.found) {
      box.appendChild(el('h3', '', '구글 지도에서 우리 병원 이름으로 찾지 못했어요'));
      box.appendChild(el('p', 'meta', m.candidates && m.candidates.length ? '비슷한 위치에서 나온 이름: ' + m.candidates.join(', ') + ' — 이 중 하나가 우리 병원이라면 지도에 올라간 이름이 다른 거예요.' : '지도에 병원이 아예 없거나, 다른 이름으로 올라 있을 수 있어요.'));
      return;
    }
    box.appendChild(el('h3', '', m.name));
    box.appendChild(el('p', 'meta', (m.rating != null ? '★' + m.rating + ' · ' : '') + '후기 ' + num(m.reviews || 0) + '건' + (m.enChecked && m.shownName !== m.name ? ' · 영어 화면에서는 "' + m.shownName + '"' : '')));
    var ul = el('ul', 'mchecks');
    if (!m.enChecked) ul.appendChild(check('unk2', '확인 못 함', '영어 화면 이름을 이번에 받아 오지 못했어요', '잠시 뒤 다시 점검하거나, 상담에서 지도 화면을 직접 보고 확인해 드려요.'));
    else {
      ul.appendChild(m.hangul ? check('ok', '맞아요', '영어 화면에서도 한글 이름이 보여요') : check('bad', '고칠 것', '영어 화면에서는 "' + m.shownName + '"(으)로만 보여요', '챗GPT 앱의 지도 카드가 이 이름을 띄워요. 한국어 질문과 우리 병원이 이어지지 않을 수 있어요.'));
      if (m.inName != null) ul.appendChild(m.inName ? check('ok', '맞아요', '지도 이름에 진료과(' + dept + ')가 들어 있어요')
        : check('bad', '고칠 것', '지도 이름에 진료과(' + dept + ') 단어가 없어요', '"' + dept + ' 추천" 같은 질문에서 이름만으로는 후보에 들기 어려워요. 지도 분류가 ' + dept + '(으)로 맞게 올라 있는지가 더 중요해져요.'));
    }
    ul.appendChild(m.category === 'match' ? check('ok', '맞아요', '지도 분류가 ' + dept + '(으)로 올라 있어요')
      : m.category === 'other' ? check('bad', '고칠 것', '지도 분류에 ' + dept + '가 없어요', '진료과에 맞는 분류를 추가해야 해요.')
        : check('unk2', '상담에서', '세부 분류(' + dept + ' 등)는 자동으로 확인할 수 없어요', '구글이 공개 자료로는 "의사"까지만 알려 줘요. 상담에서 지도 화면을 직접 보고 확인해 드려요.'));
    box.appendChild(ul);
    if (m.url) { var a = el('a', '', '구글 지도에서 열기'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; box.appendChild(a); }
  }
  var DOOR = { open: ['open', '들어옴', '검색 로봇 허용'], shut: ['shut', '막혀 있음', '홈페이지가 출입을 막아 둠'], half: ['half', '반만 열림', '구글 검색은 허용, 제미나이 이용은 꺼짐'], unknown: ['unk', '확인 못 함', '출입 규칙 파일을 읽지 못했어요'] };
  var STATE = { good: '갖춤', warn: '보완', bad: '고칠 것', unknown: '못 찾음' };
  function drawHome(h) {
    show('homesec', !!h);
    if (!h) return;
    var K4 = ['chatgpt', 'claude', 'gemini', 'perplexity'];
    var shut = K4.filter(function (k) { return h.doors[k].state === 'shut'; }).length;
    var unk = K4.filter(function (k) { return !DOOR[h.doors[k].state] || h.doors[k].state === 'unknown'; }).length;
    var lead = shut ? 'AI 4곳 가운데 ' + shut + '곳은 홈페이지에 들어오지 못해요. 그러면 홈페이지 대신 다른 사이트의 글로 병원이 소개돼요. '
      : unk ? 'AI 검색 로봇이 홈페이지에 들어올 수 있는지 ' + (unk === 4 ? '' : unk + '곳은 ') + '이번에 확인하지 못했어요. 상담에서 다시 봐 드려요. '
        : 'AI 검색 로봇은 홈페이지에 들어올 수 있어요. ';
    $('homesay').textContent = lead + '홈페이지는 AI가 "병원 말로" 소개하게 만드는 재료예요. (' + h.host + ')';
    var doors = clear($('doors'));
    ['chatgpt', 'claude', 'gemini', 'perplexity'].forEach(function (k) {
      var d = h.doors[k]; var m = DOOR[d.state] || DOOR.unknown;
      var box = el('div', 'door ' + m[0]); box.appendChild(el('h3', '', d.label));
      var inner = el('div'); inner.appendChild(el('strong', '', m[1]));
      inner.appendChild(el('p', '', d.state === 'open' && d.training === false ? '검색 로봇 허용 · 학습 수집만 막아 둠' : m[2]));
      box.appendChild(inner); doors.appendChild(box);
    });
    $('doorsfine').textContent = h.robots === 'none' ? '출입 규칙 파일(robots.txt)이 없어서 막힌 곳이 없는 것으로 봤어요.'
      : h.robots === 'unknown' ? '출입 규칙 파일(robots.txt)이 열리지 않아서 확인하지 못했어요.'
        : '출입 규칙(robots.txt) 기준이에요. 원장님이 막은 적이 없어도 제작 업체 기본 설정으로 막혀 있는 경우가 있어요.';
    var steps = clear($('steps'));
    // 글자 수는 참고만(실측: 화면을 나중에 그리는 홈페이지도 AI가 인용했다)
    var lad = (h.ladder || []).filter(function (x) { return x.id !== 'text' && x.id !== 'speed'; });
    lad.slice(0, 3).forEach(function (x, i) {
      var s = el('div', 'step'); s.appendChild(el('div', 'stk n', String(i + 1)));
      var b = el('div', 'body'); b.appendChild(el('h3', '', x.title)); b.appendChild(el('p', '', x.how));
      var need = el('div', 'need'); need.appendChild(el('b', '', '직접 하려면')); need.appendChild(document.createTextNode(x.need)); b.appendChild(need);
      s.appendChild(b); steps.appendChild(s);
    });
    if (!lad.length) steps.appendChild(el('p', 'say', '홈페이지 쪽은 크게 고칠 것이 없어요.'));
    var table = clear($('table'));
    h.items.forEach(function (x) {
      var info = x.id === 'text' || x.label === '읽을 글자';
      var row = el('div', 'row'); row.appendChild(el('b', '', x.label));
      row.appendChild(el('span', info ? '' : x.state, info ? '참고' : (STATE[x.state] || ''))); row.appendChild(el('small', '', x.detail)); table.appendChild(row);
    });
  }

  // ---------- v3: 우리 병원 소개(A) · 나란히(B) · 상담에서(C) ----------
  function iga(n) { var c = String(n).charCodeAt(String(n).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 ? '이' : '가'; }
  var GAPTIP = {
    '전문의·의료진': '환자가 가장 먼저 확인하는 항목이에요. AI가 "확인되지 않았다"고 하면 다른 병원으로 넘어가기 쉬워요.',
    '대표 시술·진료': '홈페이지에 있어도 이미지 속 글씨면 AI가 읽지 못해요(저희 11월 실측).',
    '진료시간': '"야간 진료", "주말 진료" 질문에서 후보에 들려면 꼭 필요한 정보예요.',
    '후기': '후기가 있어도 AI가 읽는 곳(구글 지도·비교 사이트)에 없으면 "후기를 찾지 못했다"고 해요.',
    '병원 평가': '좋은 곳인지 말할 근거를 AI가 찾지 못했다는 뜻이에요. 추천 질문에서도 빠지기 쉬워요.'
  };
  function drawIntro(it, g) {
    show('introsec', !!it);
    if (!it) return;
    $('introq').textContent = it.q;
    var box = clear($('introtext')); var t = it.text || ''; var pos = 0;
    var hits = (it.marks || []).map(function (m) { return { at: t.indexOf(m), m: m }; }).filter(function (x) { return x.at >= 0; }).sort(function (a, b) { return a.at - b.at; });
    hits.forEach(function (x) {
      if (x.at < pos) return;
      box.appendChild(document.createTextNode(t.slice(pos, x.at))); box.appendChild(el('mark', '', x.m)); pos = x.at + x.m.length;
    });
    box.appendChild(document.createTextNode(t.slice(pos)));
    var src = it.sources || []; var kinds = [];
    src.forEach(function (s) { if (kinds.indexOf(s.kind) < 0) kinds.push(s.kind); });
    $('introsrc').textContent = (src.length ? '출처 ' + src.length + '곳 · ' + kinds.join(', ') : '출처 표시 없음') + (g.homeKnown && !it.homeCited ? ' (우리 홈페이지는 인용되지 않음)' : '');
    var ul = clear($('gaps'));
    function li(cls, tag, what, why) { var l = el('li'); l.appendChild(el('strong', cls, tag)); l.appendChild(el('span', '', what)); if (why) l.appendChild(el('small', '', why)); ul.appendChild(l); }
    if (it.unknown) li('miss', '못 찾음', '챗GPT가 우리 병원을 찾지 못했어요', '이름으로 물어도 모르는 병원은 추천 질문에서도 나오기 어려워요.');
    (it.gaps || []).forEach(function (x) { li('miss', '모른다고 함', x.topic, GAPTIP[x.topic] || 'AI가 근거로 삼을 공개 글을 찾지 못했다는 뜻이에요.'); });
    if (it.others && it.others.length) li('soso', '다른 병원 권함', '답에 ' + it.others.join(', ') + iga(it.others[it.others.length - 1]) + ' 같이 나왔어요', '우리 병원 이름으로 물었는데도 다른 병원이 함께 나왔어요.');
    if (!it.unknown && g.hits === 0 && g.asked) li('miss', '추천엔 없음', '이름을 대면 소개하는데, 추천 질문 ' + g.asked + '개에서는 한 번도 안 나왔어요', '새 환자는 병원 이름을 모른 채 "추천해줘"라고 물어요. 거기서 나와야 처음 오는 환자가 생겨요.');
    if (!ul.firstChild) li('okk', '빈칸 없음', '이번 답에서는 모른다고 한 항목이 없었어요', '내용이 맞는지는 원장님이 봐 주세요.');
  }
  function drawCompare(c, m, rm, g, nm) {
    show('vssec', !!c);
    $('lk3').textContent = c ? c.rival.name + iga(c.rival.name) + ' 인용된 글 전체 목록' : '많이 나온 병원이 인용된 글 전체 목록';
    if (!c) return;
    var R = c.rival, O = c.ours;
    var h = clear($('vstitle'));
    h.appendChild(document.createTextNode(c.oursTop ? '우리 다음으로 많이 나온' : c.clinicOnly ? '큰 병원을 빼면 가장 많이 나온' : '이 지역에서 가장 많이 나온')); h.appendChild(el('br'));
    h.appendChild(document.createTextNode('병원과 ')); h.appendChild(el('span', 'box', '나란히')); h.appendChild(document.createTextNode(' 놓고 보면'));
    $('vssay').textContent = '같은 질문 ' + g.asked + '개에서 ' + (c.oursTop ? '우리 다음으로 ' : '가장 ') + '많이 나온 곳은 ' + R.name + (iga(R.name) === '이' ? '이에요. ' : '예요. ') + (c.clinicOnly ? '(대학병원·종합병원은 뺐어요.) ' : '') + '챗GPT 답과 구글 지도에서 찾은 차이만 놓았어요.';
    var vs = clear($('vs'));
    var head = el('div', 'vsh'); head.appendChild(el('span'));
    var b1 = el('b', 'me', '우리 병원'); b1.appendChild(el('small', '', nm)); head.appendChild(b1);
    var b2 = el('b', '', c.oursTop ? '2등 병원' : '1등 병원'); b2.appendChild(el('small', '', R.name)); head.appendChild(b2); vs.appendChild(head);
    function row(label, a, b, aSub, bSub, lowA, lowB, tx) {
      var r = el('div', 'vsr'); r.appendChild(el('span', '', label));
      [[a, aSub, lowA], [b, bSub, lowB]].forEach(function (v) { var e = el('em', (v[2] ? 'lo' : '') + (tx ? ' tx' : ''), v[0]); if (v[1]) e.appendChild(el('small', '', v[1])); r.appendChild(e); });
      vs.appendChild(r);
    }
    function kinds(x) { return x.n ? x.kinds.map(function (k) { return k.kind + ' ' + k.n; }).join(' · ') : '없음'; }
    row('챗GPT 답에 나옴', O.hits + ' / ' + g.asked, R.hits + ' / ' + g.asked, null, null, O.hits < R.hits, R.hits < O.hits);
    if (O.cited.n || R.cited.n) row('답에 쓰인 그 병원 글', O.cited.n + '회', R.cited.n + '회', kinds(O.cited), kinds(R.cited), O.cited.n < R.cited.n, R.cited.n < O.cited.n);
    var both = m && m.found && rm && rm.found;
    if (both) row('구글 지도 후기', num(m.reviews || 0) + '건', num(rm.reviews || 0) + '건', null, null, false, false);
    var bothEn = both && m.enChecked && rm.enChecked;
    if (bothEn) row('영어 화면 지도 이름', '"' + m.shownName + '"', '"' + rm.shownName + '"', m.inName ? '진료과 단어 있음' : '진료과 단어 없음', rm.inName ? '진료과 단어 있음' : '진료과 단어 없음', m.inName === false, rm.inName === false, true);
    // 반전: 후기는 우리가 훨씬 많은데 추천은 상대가 더 받은 경우
    var tw = !c.oursTop && both && rm.reviews > 0 && m.reviews >= rm.reviews * 1.5;
    var twist = clear($('twist')); show('twist', tw);
    if (tw) {
      var x = Math.floor(m.reviews / rm.reviews);
      twist.appendChild(document.createTextNode('후기는 우리가 ' + (x >= 2 ? x + '배 넘게' : '더') + ' 많은데, 추천은 ' + R.name + iga(R.name) + ' 더 받았어요.'));
      twist.appendChild(el('span', '', '챗GPT가 근거로 쓰는 글과 지도 이름이 갈랐다는 뜻이에요. 후기를 더 모으는 것만으로는 잘 안 바뀌어요.'));
    }
    var d = clear($('diff')); var n = 0;
    function item(title, p, locked) { var l = el('li', locked ? 'locked' : ''); var w = el('div'); w.appendChild(el('b', '', title)); w.appendChild(el('p', '', p)); if (locked) w.appendChild(el('i', '', '상담에서 전체 목록을 보여 드려요')); l.appendChild(w); d.appendChild(l); n++; }
    if (O.cited.n === 0 && R.cited.n > 0) item('우리 병원 글이 답의 근거로 한 번도 안 쓰였어요', R.name + ' 글은 ' + R.cited.n + '번 쓰였어요(' + kinds(R.cited) + ').');
    else if (O.cited.n < R.cited.n) item('답의 근거로 쓰인 우리 병원 글이 더 적어요', '우리 ' + O.cited.n + '회, ' + R.name + ' ' + R.cited.n + '회예요.');
    if (bothEn && m.inName === false && rm.inName) item('지도 이름에 "' + g.dept + '"가 없어요', '영어 화면(챗GPT 앱 지도 카드)에서 "' + m.shownName + '"(으)로만 보여요. ' + R.name + ' 쪽은 "' + rm.shownName + '"(으)로 보여요.');
    else if (bothEn && m.hangul === false && rm.hangul) item('영어 화면에서 지도 이름이 한글로 안 보여요', '"' + m.shownName + '"(으)로만 보여요. 한국어 질문과 이어지지 않을 수 있어요.');
    if (!c.oursTop && R.hits > O.hits && n < 2) item('같은 질문에서 ' + R.hits + '번 나왔어요', '우리 병원은 ' + O.hits + '번이에요. 질문 종류별로 어디서 갈리는지는 위 질문별 결과에 있어요.');
    item(R.name + iga(R.name) + ' 인용된 글이 무엇인지', '어떤 글이 어떤 질문에서 쓰였는지 목록으로 정리했어요', true);
    $('diffh').textContent = n > 1 ? '차이 ' + n + '가지' : '더 볼 것';
    return tw;
  }

  function render(r, isSample) {
    current = isSample ? null : r;
    var g = r.gpt;
    show('sample', isSample); show('result', true);
    var who = clear($('who'));
    who.appendChild(el('b', '', r.name));
    var when = g.measured_at ? new Date(g.measured_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' 측정' : '예시';
    who.appendChild(document.createTextNode(' · ' + g.dept + ' · ' + g.regions.join(', ') + ' · ' + when));
    show('again', !isSample);
    $('num').textContent = g.hits; $('den').textContent = '/ ' + g.asked;
    $('verdict').textContent = verdict(g);
    $('cond').textContent = '챗GPT 검색 기능(OpenAI API) 기준, 질문마다 한 번씩 물어본 결과예요. 챗GPT 앱 화면·로그인 여부·클로드·제미나이에서는 다르게 나올 수 있어요. 그 조건들은 상담에서 직접 재 드려요.';
    drawQuestions(g); drawRivals(g, r.name); drawSources(g, isSample || !!(home || picked && picked.url)); drawMap(r.map, g.dept);
    drawHome(isSample ? null : home);
    drawIntro(g.intro, g);
    var tw = drawCompare(g.compare, r.map, r.rivalMap, g, r.name);
    $('ghostgpt').textContent = g.hits + '/' + g.asked;
    $('barnum').textContent = g.hits + '/' + g.asked; $('barsay').textContent = tw ? '후기는 더 많은데 추천은 덜' : '질문에서 추천됨';
    show('bar', !isSample);
    openCall(isSample ? null : r);
  }

  // ---------- 상담 ----------
  function mode() { var c = document.querySelector('input[name=mode]:checked'); return c ? c.value : 'phone'; }
  function syncMode() {
    var v = mode() === 'visit';
    clear($('tmlabel')).appendChild(document.createTextNode(v ? '방문 편한 날짜·시간 ' : '통화 편한 시간 ')); $('tmlabel').appendChild(el('span', '', '선택'));
    $('tm').placeholder = v ? '예: 다음 주 화요일 점심, 진료 끝난 뒤' : '예: 평일 점심시간, 오후 6시 이후';
  }
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mode]'), function (x) { x.addEventListener('change', syncMode); });
  function openCall(r) {
    show('call', true);
    var g = r && r.gpt;
    $('callsay').textContent = g
      ? (g.hits < g.asked ? '빠진 질문 ' + (g.asked - g.hits) + '개에서 왜 다른 병원이 나왔는지, ' : '') + '클로드·제미나이·퍼플렉시티와 로그인한 챗GPT에서는 어떤지 직접 재서 설명드려요. 무엇을 고치면 나오는지까지 알려 드리고, 상담 비용은 없어요. 전화로도, 병원에 찾아가서도 괜찮아요.'
      : '병원 이름과 연락처를 남기시면 저희가 직접 재서 설명드려요. 상담 비용은 없어요. 전화로도, 병원에 찾아가서도 괜찮아요.';
    if (r && !$('hn').value) $('hn').value = String(r.name || '').slice(0, 40);
  }
  $('callform').addEventListener('submit', function (e) {
    e.preventDefault();
    var hn = $('hn'), ph = $('ph'), ag = $('ag'), btn = $('callgo');
    var okHn = hn.value.trim().length > 0, digits = ph.value.replace(/[^0-9]/g, ''), okPh = digits.length >= 9 && digits.length <= 11, okAg = ag.checked;
    show('hnerr', !okHn); show('pherr', !okPh); show('agerr', !okAg); show('senderr', false);
    if (!okHn) return hn.focus(); if (!okPh) return ph.focus(); if (!okAg) return ag.focus();
    btn.disabled = true; btn.textContent = '보내는 중';
    var m = mode();
    post('lead', { hospital: hn.value.trim(), phone: ph.value, time: $('tm').value.trim(), consent: true, mode: m, token: current ? current.token : null, home: home ? home.token : null }).then(function (r) {
      if (r.ok) { btn.textContent = '신청 완료'; $('done').textContent = m === 'visit' ? '신청됐어요. 하루 안에 전화드려서 방문 날짜를 정할게요.' : '신청됐어요. 하루 안에 전화드릴게요.'; show('done', true); return; }
      btn.disabled = false; btn.textContent = '무료 상담 신청하기';
      $('senderr').textContent = r.reason === 'slow_down' ? '잠시 뒤에 다시 눌러 주세요.' : '신청이 전송되지 않았어요. 다시 눌러 주시거나 카카오톡으로 알려 주세요.';
      show('senderr', true);
    });
  });
  $('kakao').addEventListener('click', function () {
    if (current) {
      var g = current.gpt;
      var text = '[병원 AI 검색 점검]' + NL + current.name + ' · 챗GPT 추천 ' + g.hits + '/' + g.asked + ' (' + g.regions.join(', ') + ' ' + g.dept + ')' + NL + '결과 링크: ' + location.origin + BASE + 'r/' + current.token;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () { /* 복사 실패는 넘어간다 */ });
      toast('점검 결과를 복사했어요. 카카오톡에 붙여 넣어 주세요.');
    }
    window.open(OPENCHAT, '_blank', 'noopener');
  });

  // ---------- 시작 ----------
  $('privlink').href = BASE + 'privacy'; $('privlink2').href = BASE + 'privacy';
  var mm = location.pathname.match(/\/r\/([A-Za-z0-9_-]{8,16})$/);
  if (mm) {
    fetch('/api/hospital/report/' + mm[1]).then(function (r) { return r.json(); }).then(function (r) {
      if (r && r.ok && r.result.kind === 'probe') render({ name: r.result.name, gpt: r.result.gpt, map: r.result.map, rivalMap: r.result.rivalMap, token: r.result.token }, false);
      else { render(SAMPLE, true); note('이 결과 링크는 더 이상 열리지 않아요', '위에 병원 이름을 넣어 다시 점검해 주세요.'); }
    }).catch(function () { render(SAMPLE, true); });
  } else render(SAMPLE, true);
})();
