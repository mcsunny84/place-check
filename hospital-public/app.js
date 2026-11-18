'use strict';
// 병원 홈페이지 AI 검색 점검 — 화면 동작. 서버가 준 글자는 전부 textContent 로만 넣는다.
(function () {
  var OPENCHAT = 'https://open.kakao.com/o/svWyvDXi';
  // 개발용(localhost/hospital/)과 운영 주소(/) 양쪽에서 같은 파일이 돈다
  var BASE = location.pathname === '/hospital' || location.pathname.indexOf('/hospital/') === 0 ? '/hospital/' : '/';
  var $ = function (id) { return document.getElementById(id); };
  var NL = String.fromCharCode(10);
  var current = null; // 지금 보이는 실제 결과(예시는 null)
  var pickedName = '';
  // 2026-11-18 실전 시험: 네이버 지역 검색 위쪽에 나오는 피부과·성형외과·치과 의원 홈페이지 61곳을 이 점검으로 본 평균(중앙값도 60점)
  var AVG = { score: 60, label: '상위 노출 의원 61곳 평균 60점' };

  // 지어낸 병원으로 만든 예시(첫 화면 아래에만 쓴다)
  var SAMPLE = {
    host: 'raon-skin.example', sample: true, score: 34, grade: 'D', after: 100, robots: 'rules', critical: [], trainingOff: [],
    doors: { chatgpt: { label: '챗GPT', state: 'open' }, claude: { label: '클로드', state: 'shut' }, gemini: { label: '제미나이', state: 'half' }, perplexity: { label: '퍼플렉시티', state: 'shut' } },
    read: { chars: 41, title: '라온피부과의원', images: { total: 9, withAlt: 0 }, lines: ['라온피부과의원', '로그인 회원가입', '이벤트 더보기', 'Copyright RAON'],
      list: [{ label: '병원 이름', state: 'yes' }, { label: '주소 · 전화번호', state: 'no' }, { label: '진료시간 · 휴진일', state: 'no' }, { label: '진료 · 시술별 설명', state: 'no' }, { label: '의료진 · 전문의 여부', state: 'no' }, { label: '자주 묻는 질문', state: 'no' }] },
    items: [
      { label: '4대 AI 검색 로봇 출입', got: 6, max: 16, state: 'bad', detail: '클로드 · 퍼플렉시티 검색 로봇이 막혀 있어요' },
      { label: '읽을 글자', got: 0, max: 16, state: 'bad', detail: '첫 화면의 설명 문장 0자(메뉴·버튼까지 합치면 41자), 이미지 9장 중 설명이 있는 것 0장' },
      { label: '병원 구조화 정보', got: 4, max: 18, state: 'warn', detail: '형식은 있는데 빠진 것: 병원 종류 · 주소·전화 · 진료시간 · 의료진 · 공식 채널 연결' },
      { label: '자주 묻는 질문', got: 0, max: 12, state: 'unknown', detail: '질문과 답으로 된 글을 찾지 못했어요' },
      { label: '진료별 페이지', got: 10, max: 10, state: 'good', detail: '사이트맵에서 페이지 64개를 확인했어요' },
      { label: '의료진 정보', got: 3, max: 12, state: 'warn', detail: '의료진 페이지는 있는데 전문의 여부·약력을 글자로 찾지 못했어요' },
      { label: '주소·전화·진료시간', got: 2, max: 6, state: 'warn', detail: '주소 · 진료시간을(를) 글자로 찾지 못했어요' },
      { label: '속도·모바일', got: 4, max: 4, state: 'good', detail: '첫 화면을 받는 데 0.6초' },
      { label: '기본 설정', got: 5, max: 6, state: 'good', detail: '빠진 것: 페이지 제목' }],
    ladder: [
      { gain: 14, title: '구조화 정보에 병원 종류 · 주소·전화 · 진료시간 채우기', how: '병원 종류, 주소, 전화, 진료시간, 의료진, 네이버 플레이스 같은 공식 채널 주소를 정해진 형식(구조화 정보)으로 홈페이지 코드에 넣어요. AI가 "이 홈페이지가 그 병원"이라고 확인하는 근거예요.', need: '홈페이지 코드를 수정할 권한과 개발자가 필요해요.' },
      { gain: 12, title: '이미지 속 글자를 진짜 글자로 바꾸기', how: '시술 이름, 설명, 진료 안내를 이미지가 아니라 글자로 넣어야 AI가 읽어 가요.', need: '홈페이지 관리자 권한과 페이지 다시 제작이 필요해요. 바뀐 문구는 의료광고 기준 확인이 필요해요.' },
      { gain: 12, title: '환자들이 실제로 묻는 질문과 답 넣기', how: '"시술 뒤 며칠 뒤에 세안해도 되나요" 같은 질문과 원장님의 답을 글자로 올리고, FAQ 구조화 표시를 붙여요.', need: '질문 15~20개 정리와 원장님 답변 작성, 의료광고 기준 확인, 코드 수정이 필요해요.' },
      { gain: 9, title: '의료진 약력을 글자로 올리기', how: '전문의 여부, 학력, 경력, 학회 활동을 이미지가 아니라 글자로 적어요. AI가 병원을 소개할 때 가장 먼저 찾는 내용이에요.', need: '의료진 페이지를 다시 만들어야 해요. 경력 표기는 의료광고 기준 확인이 필요해요.' },
      { gain: 8, title: '클로드 · 퍼플렉시티 출입 열기', how: '출입 규칙 파일(robots.txt)에서 이 AI의 검색 로봇을 막는 줄을 고쳐요.', need: '홈페이지 서버 접속 권한이 필요해요. 줄을 잘못 지우면 네이버·구글 검색까지 막힐 수 있어요.' },
      { gain: 4, title: '이미지마다 설명 글 달기', how: '설명이 없는 이미지 9장에 무엇을 보여 주는 이미지인지 한 줄씩 적어요.', need: '홈페이지 관리자 화면에서 이미지마다 입력해야 해요. 장 수가 많으면 시간이 걸려요.' },
      { gain: 4, title: '주소 · 진료시간 글자로 적기', how: '이미지 안이 아니라 글자로 적어야 AI가 "몇 시까지 해요?" 같은 질문에 답할 수 있어요.', need: '홈페이지 관리자 화면에서 고칠 수 있어요. 어렵지 않아요.' },
      { gain: 2, title: '제미나이 이용 설정 켜기', how: '출입 규칙 파일에서 Google-Extended를 막는 줄을 고쳐요.', need: '홈페이지 서버 접속 권한이 필요해요.' },
      { gain: 1, title: '페이지 제목 넣기', how: '검색 결과와 AI가 페이지를 구분할 때 쓰는 기본 정보예요.', need: '홈페이지 관리자 화면에서 10분이면 돼요.' }]
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

  // ---------- 입력 · 후보 · 안내 ----------
  var waitTimer = null;
  function waiting(on, steps) {
    show('wait', on); $('go').disabled = on;
    clearInterval(waitTimer);
    if (!on) return;
    var i = 0; $('waittext').textContent = steps[0];
    waitTimer = setInterval(function () { i = Math.min(i + 1, steps.length - 1); $('waittext').textContent = steps[i]; }, 2200);
  }
  function note(title, text) {
    var n = clear($('note'));
    if (!title && !text) { n.hidden = true; return; }
    if (title) n.appendChild(el('b', '', title));
    if (text) n.appendChild(document.createTextNode(text));
    n.hidden = false;
  }
  var MSG = {
    bad_url: ['주소를 다시 확인해 주세요', '홈페이지 주소가 아닌 것 같아요. 예: www.병원주소.com'],
    unreachable: ['홈페이지가 열리지 않았어요', '주소가 맞는지 확인해 주세요. 주소가 맞는데도 열리지 않는다면 AI 로봇도 같은 화면을 보게 돼요.'],
    blocked: ['홈페이지가 자동 접속을 막고 있어서 점검하지 못했어요', '보안 설정이 사람 아닌 접속을 막는 경우예요. AI 로봇이 어떻게 보이는지는 직접 확인해 봐야 해서, 전화로 신청해 주시면 확인해서 알려 드릴게요.'],
    slow_down: ['잠시 뒤에 다시 해 주세요', '짧은 시간에 여러 번 점검해서 잠깐 멈췄어요. 1분 뒤에 다시 눌러 주세요.'],
    busy: ['지금 점검이 몰려 있어요', '1분 뒤에 다시 눌러 주세요.'],
    cooldown: ['지금은 병원 이름 검색이 어려워요', '홈페이지 주소를 직접 넣으면 바로 점검돼요.'],
    unreadable: ['병원 이름 검색 결과를 읽지 못했어요', '홈페이지 주소를 직접 넣으면 바로 점검돼요.'],
    too_short: ['두 글자 이상 적어 주세요', ''],
    too_long: ['조금 짧게 적어 주세요', '병원 이름만 적거나 홈페이지 주소를 넣어 주세요.'],
    offline: ['연결이 끊겼어요', '인터넷 연결을 확인하고 다시 눌러 주세요.'],
    error: ['점검 중에 문제가 생겼어요', '잠시 뒤에 다시 눌러 주세요.']
  };
  function fail(reason) { var m = MSG[reason] || MSG.error; note(m[0], m[1]); if (reason === 'blocked') openCall('blocked'); }

  function looksLikeUrl(s) { return /^https?:\/\//i.test(s) || /^[^\s/]+\.[a-z]{2,}(\/|$|:|\?)/i.test(s) || /^www\./i.test(s); }

  function runCheck(url) {
    note(); show('cands', false);
    waiting(true, ['홈페이지를 여는 중이에요', 'AI 로봇 출입 규칙을 읽는 중이에요', '읽을 글자를 세는 중이에요', '의료진·질문 페이지를 보는 중이에요', '거의 다 됐어요']);
    return post('check', { url: url }).then(function (r) {
      waiting(false);
      if (!r.ok) return fail(r.reason);
      render(r.result, false);
      try { history.replaceState(null, '', BASE + 'r/' + r.result.token); } catch (e) { /* 무시 */ }
      $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function runSearch(q) {
    note(); show('cands', false);
    waiting(true, ['병원을 찾는 중이에요']);
    post('search', { q: q }).then(function (r) {
      waiting(false);
      if (!r.ok) return fail(r.reason);
      if (!r.items.length) return note('병원을 찾지 못했어요', '이름을 조금 다르게 적어 보시거나 홈페이지 주소를 직접 넣어 주세요.');
      var box = clear($('cands'));
      box.appendChild(el('p', '', '이 병원이 맞나요? 하나를 골라 주세요.'));
      r.items.forEach(function (it) {
        var b = el('button'); b.type = 'button';
        var left = el('span'); left.appendChild(el('b', '', it.name)); if (it.category) left.appendChild(document.createTextNode(' · ' + it.category));
        b.appendChild(left); b.appendChild(el('small', '', it.address || ''));
        b.addEventListener('click', function () { pick(it); });
        box.appendChild(b);
      });
      box.hidden = false;
    });
  }
  function pick(it) {
    show('cands', false); pickedName = it.name;
    waiting(true, ['병원 홈페이지 주소를 찾는 중이에요']);
    post('pick', { id: it.id }).then(function (r) {
      if (r.ok) { $('q').value = r.url; return runCheck(r.url); }
      waiting(false);
      if (r.reason === 'no_homepage') {
        note('네이버 플레이스에 홈페이지 주소가 없어요', r.sns ? '블로그나 SNS 주소만 등록돼 있어요. 홈페이지 주소를 아시면 직접 넣어 주세요.' : '홈페이지 주소를 아시면 직접 넣어 주세요. 홈페이지가 아직 없다면 그것부터 전화로 설명드릴게요.');
        return openCall('nohome');
      }
      fail(r.reason);
    });
  }
  $('ask').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('q').value.replace(/\s+/g, ' ').trim();
    if (!q) { $('q').focus(); return; }
    if (looksLikeUrl(q)) { pickedName = ''; runCheck(q); } else runSearch(q);
  });
  $('again').addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); $('q').value = ''; $('q').focus(); });

  // ---------- 결과 그리기 ----------
  var DOOR = {
    open: ['open', '들어옴', '검색 로봇 허용'],
    shut: ['shut', '막혀 있음', '홈페이지가 출입을 막아 둠'],
    half: ['half', '반만 열림', '구글 검색은 허용, 제미나이 이용은 꺼짐'],
    unknown: ['unk', '확인 못 함', '출입 규칙 파일을 읽지 못했어요']
  };
  function verdict(r) {
    var ds = Object.keys(r.doors).map(function (k) { return r.doors[k]; });
    var shut = ds.filter(function (d) { return d.state === 'shut'; }).length;
    var low = r.read.chars < 300;
    if (shut === 4) return '지금 홈페이지는 4대 AI가 전부 들어오지 못하게 막혀 있어요.';
    if (shut && low) return '지금 홈페이지는 4대 AI 가운데 ' + shut + '곳이 들어오지 못하고, 들어온 AI도 읽을 글자가 거의 없어요.';
    if (shut) return '지금 홈페이지는 4대 AI 가운데 ' + shut + '곳이 들어오지 못해요.';
    if (low) return 'AI가 들어올 수는 있는데, 들어와서 읽어 갈 글자가 거의 없어요.';
    if (r.grade === 'A') return 'AI가 읽어 갈 준비가 잘 돼 있어요. 남은 건 실제로 AI 답변에 나오는지 확인하는 일이에요.';
    if (r.grade === 'B') return '기본은 갖췄어요. 아래 몇 가지가 빠져서 AI가 병원을 설명할 재료가 모자라요.';
    return 'AI가 들어와서 글자는 읽지만, 병원을 소개할 때 필요한 정보가 여러 개 빠져 있어요.';
  }
  function drawSite(r) {
    var s = clear($('site')); var im = r.read.images.total;
    var nav = el('div', 'nav'); nav.appendChild(el('span', '', (r.read.title || r.host).replace(/\s/g, '').slice(0, 7))); nav.appendChild(el('span', '', '≡')); s.appendChild(nav);
    if (im >= 1) {
      s.appendChild(el('div', 'ban'));
      if (im >= 2) { var ev = el('div', 'ev'); ev.appendChild(el('div', '', '사진')); ev.appendChild(el('div', '', '배너')); s.appendChild(ev); }
      else { var t1 = el('div', 'txt'); for (var a = 0; a < 6; a++) t1.appendChild(el('i')); s.appendChild(t1); }
      $('sitetag').textContent = '이미지 ' + num(im) + '장'; show('sitetag', true);
    } else {
      var t = el('div', 'txt'); for (var i = 0; i < 14; i++) t.appendChild(el('i')); s.appendChild(t); show('sitetag', false);
    }
  }
  function drawRead(r) {
    var box = clear($('read')); var lines = r.read.lines || []; var low = r.read.chars < 300;
    var head = low ? lines.slice(0, 3) : lines.slice(0, 9);
    head.forEach(function (l) { box.appendChild(el('p', '', l)); });
    if (low) {
      var gap = el('div', 'gap'); gap.appendChild(document.createTextNode(lines.length ? '읽을 글자 없음' : '읽힌 글자 없음'));
      if (r.read.images.total) { gap.appendChild(el('br')); gap.appendChild(document.createTextNode('(이미지 ' + num(r.read.images.total) + '장)')); }
      box.appendChild(gap);
      lines.slice(3, 5).forEach(function (l) { box.appendChild(el('p', '', l)); });
    } else if (lines.length > 9) box.appendChild(el('p', '', '…'));
  }
  function render(r, isSample) {
    current = isSample ? null : r;
    show('sample', isSample); show('result', true);
    var al = clear($('alerts'));
    (r.critical || []).forEach(function (c) { var a = el('div', 'alert', c); a.appendChild(el('span', '', 'AI보다 먼저, 검색에 나오는 것 자체가 막힌 상태예요. 이것부터 고쳐야 해요.')); al.appendChild(a); });
    var who = clear($('who'));
    who.appendChild(el('b', '', isSample ? '라온피부과의원' : (pickedName || r.read.title || r.host)));
    var when = r.checked_at ? new Date(r.checked_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' 점검' : '예시';
    who.appendChild(document.createTextNode(' · ' + r.host + ' · ' + when));
    show('again', !isSample);
    $('num').textContent = r.score; $('grade').textContent = r.grade + '등급'; $('verdict').textContent = verdict(r);
    var avg = clear($('avg'));
    var me = el('i', 'me'); me.style.left = Math.max(2, Math.min(98, r.score)) + '%'; avg.appendChild(me);
    var meL = el('em', '', '우리 ' + r.score + '점'); meL.style.left = Math.max(12, Math.min(88, r.score)) + '%'; avg.appendChild(meL);
    var mk = el('i'); mk.style.left = AVG.score + '%'; avg.appendChild(mk);
    var mkL = el('em', 'tick', AVG.label); mkL.style.left = Math.max(30, Math.min(70, AVG.score)) + '%'; avg.appendChild(mkL);

    var doors = clear($('doors'));
    ['chatgpt', 'claude', 'gemini', 'perplexity'].forEach(function (k) {
      var d = r.doors[k]; var m = DOOR[d.state] || DOOR.unknown;
      var box = el('div', 'door ' + m[0]); box.appendChild(el('h3', '', d.label));
      var inner = el('div'); inner.appendChild(el('strong', '', m[1]));
      inner.appendChild(el('p', '', d.state === 'open' && d.training === false ? '검색 로봇 허용 · 학습 수집만 막아 둠' : m[2]));
      box.appendChild(inner); doors.appendChild(box);
    });
    $('doorsfine').textContent = r.robots === 'none'
      ? '홈페이지에 출입 규칙 파일(robots.txt)이 없어서 막힌 곳이 없는 것으로 봤어요.'
      : r.robots === 'unknown' ? '출입 규칙 파일(robots.txt)이 열리지 않아서 4곳 모두 확인하지 못했어요. 이 항목은 0점으로 계산했어요.'
        : '홈페이지의 출입 규칙(robots.txt)을 기준으로 본 결과예요. 원장님이 막은 적이 없어도 제작 업체의 기본 설정으로 막혀 있는 경우가 있어요.';

    var low = r.read.chars < 300;
    var vt = clear($('vtitle'));
    if (low) { vt.appendChild(document.createTextNode('같은 홈페이지인데')); vt.appendChild(el('br')); vt.appendChild(el('span', 'box', 'AI가 읽은 건')); vt.appendChild(document.createTextNode(' 이게 전부예요')); }
    else { vt.appendChild(el('span', 'box', 'AI가 읽어 간')); vt.appendChild(el('br')); vt.appendChild(document.createTextNode('첫 화면이에요')); }
    $('chars').textContent = num(r.read.chars);
    drawSite(r); drawRead(r);
    var im = r.read.images.total;
    $('vsay').textContent = low && im >= 3
      ? '첫 화면에 이미지는 ' + num(im) + '장인데 글자는 ' + num(r.read.chars) + '자예요. 이벤트 가격, 시술 이름, 진료시간이 이미지 안에 들어 있으면 사람 눈에는 보여도 AI는 가져가지 못해요.'
      : low ? '첫 화면에 AI가 읽을 글자가 거의 없어요. 화면을 나중에 그려 넣는 방식의 홈페이지는 AI 로봇에게 빈 화면으로 보일 수 있어요.'
        : '첫 화면의 글자는 AI가 읽어 갈 수 있어요. 아래에서 빠진 정보가 있는지 확인해 보세요.';
    var cant = clear($('cant'));
    r.read.list.forEach(function (x) { var li = el('li'); li.appendChild(el('span', '', x.label)); li.appendChild(el('span', x.state === 'yes' ? 'yes' : 'no', x.state === 'yes' ? '읽음' : '찾지 못함')); cant.appendChild(li); });

    var n = r.ladder.length;
    var jump = clear($('jump'));
    if (n) { jump.appendChild(el('s', '', r.score + '점')); jump.appendChild(document.createTextNode(' → ')); jump.appendChild(el('i', '', r.after + '점')); }
    else jump.appendChild(el('i', '', r.score + '점'));
    $('ltitle').textContent = n ? '이걸 고치면' : '고칠 것이 없어요';
    $('lsay').textContent = n ? '오르는 점수가 큰 것부터예요. 방법은 알려 드리고, 직접 하기 어려운 건 맡기셔도 돼요.' : '홈페이지는 준비가 끝났어요. 이제 AI가 실제로 우리 병원을 답변에 넣는지 확인할 차례예요.';
    var steps = clear($('steps'));
    function stepNode(x) {
      var s = el('div', 'step'); s.appendChild(el('div', 'stk', '+' + x.gain + '점'));
      var b = el('div', 'body'); b.appendChild(el('h3', '', x.title)); b.appendChild(el('p', '', x.how));
      var need = el('div', 'need'); need.appendChild(el('b', '', '직접 하려면')); need.appendChild(document.createTextNode(x.need)); b.appendChild(need);
      s.appendChild(b); return s;
    }
    r.ladder.slice(0, 3).forEach(function (x) { steps.appendChild(stepNode(x)); });
    if (n > 3) {
      var rest = r.ladder.slice(3); var d = el('details', 'more');
      d.appendChild(el('summary', '', '나머지 ' + rest.length + '개 보기 (+' + rest.reduce(function (a, x) { return a + x.gain; }, 0) + '점)'));
      rest.forEach(function (x) { d.appendChild(stepNode(x)); }); steps.appendChild(d);
    }
    var table = clear($('table'));
    r.items.forEach(function (x) { var row = el('div', 'row'); row.appendChild(el('b', '', x.label)); row.appendChild(el('span', x.state, x.got + ' / ' + x.max)); row.appendChild(el('small', '', x.detail)); table.appendChild(row); });

    $('barnum').textContent = r.score + '점'; $('barsay').textContent = n ? '고칠 것 ' + n + '개' : r.grade + '등급';
    show('bar', !isSample);
    openCall(isSample ? 'sample' : 'result', r);
  }

  // ---------- 상담 ----------
  function openCall(mode, r) {
    show('call', true);
    var n = r ? r.ladder.length : 0;
    $('callsay').textContent = mode === 'result'
      ? '이 점검 결과를 보고 하루 안에 전화드려요. ' + (n ? '고칠 ' + n + '개를 어떤 순서로 하면 되는지, 그리고 ' : '') + '챗GPT · 클로드 · 제미나이 · 퍼플렉시티가 실제로 우리 병원을 추천하는지도 함께 확인해서 말씀드려요.'
      : mode === 'blocked' ? '자동 점검이 막힌 홈페이지는 직접 열어서 확인해요. 하루 안에 전화로 결과를 알려 드리고, 챗GPT · 클로드 · 제미나이 · 퍼플렉시티가 실제로 우리 병원을 추천하는지도 함께 확인해요.'
        : mode === 'nohome' ? '홈페이지가 없거나 주소를 모르셔도 괜찮아요. 하루 안에 전화드려서, AI가 지금 우리 병원을 어떻게 설명하는지부터 확인해 드려요.'
          : '병원 이름과 연락처를 남기시면 대신 점검해서 하루 안에 전화드려요. 챗GPT · 클로드 · 제미나이 · 퍼플렉시티가 실제로 우리 병원을 추천하는지도 함께 확인해요.';
    $('kakaosay').textContent = mode === 'result' ? '누르면 이 점검 결과가 복사되고 카카오톡 1:1 오픈채팅이 열려요. 붙여 넣어 주세요.' : '누르면 카카오톡 1:1 오픈채팅이 열려요.';
    if (mode !== 'sample' && !$('hn').value) $('hn').value = (pickedName || (r && r.read.title) || '').slice(0, 40);
    if (mode === 'blocked' || mode === 'nohome') $('call').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('callform').addEventListener('submit', function (e) {
    e.preventDefault();
    var hn = $('hn'), ph = $('ph'), ag = $('ag'), btn = $('callgo');
    var okHn = hn.value.trim().length > 0, digits = ph.value.replace(/[^0-9]/g, ''), okPh = digits.length >= 9 && digits.length <= 11, okAg = ag.checked;
    show('hnerr', !okHn); show('pherr', !okPh); show('agerr', !okAg); show('senderr', false);
    if (!okHn) return hn.focus(); if (!okPh) return ph.focus(); if (!okAg) return ag.focus();
    btn.disabled = true; btn.textContent = '보내는 중';
    post('lead', { hospital: hn.value.trim(), phone: ph.value, time: $('tm').value.trim(), consent: true, token: current ? current.token : null }).then(function (r) {
      if (r.ok) { btn.textContent = '신청 완료'; show('done', true); return; }
      btn.disabled = false; btn.textContent = '전화 상담 신청하기';
      $('senderr').textContent = r.reason === 'slow_down' ? '잠시 뒤에 다시 눌러 주세요.' : '신청이 전송되지 않았어요. 다시 눌러 주시거나 카카오톡으로 알려 주세요.';
      show('senderr', true);
    });
  });
  $('kakao').addEventListener('click', function () {
    if (current) {
      var text = '[병원 홈페이지 AI 검색 점검]' + NL + (pickedName || current.read.title || current.host) + ' · ' + current.score + '점 · ' + current.grade + '등급 · 고칠 것 ' + current.ladder.length + '개' + NL + '결과 링크: ' + location.origin + BASE + 'r/' + current.token;
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(function () { /* 복사 실패는 넘어간다 */ });
      toast('점검 결과를 복사했어요. 카카오톡에 붙여 넣어 주세요.');
    }
    window.open(OPENCHAT, '_blank', 'noopener');
  });

  // ---------- 시작 ----------
  $('privlink').href = BASE + 'privacy'; $('privlink2').href = BASE + 'privacy';
  var m = location.pathname.match(/\/r\/([A-Za-z0-9_-]{8,16})$/);
  if (m) {
    fetch('/api/hospital/report/' + m[1]).then(function (r) { return r.json(); }).then(function (r) {
      if (r && r.ok) render(r.result, false); else { render(SAMPLE, true); note('이 결과 링크는 더 이상 열리지 않아요', '위에 병원 이름이나 홈페이지 주소를 넣어 다시 점검해 주세요.'); }
    }).catch(function () { render(SAMPLE, true); });
  } else render(SAMPLE, true);
})();
