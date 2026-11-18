'use strict';
const test = require('node:test');
const assert = require('node:assert');
const H = require('../lib/hospital/html');

test('주석 속 태그는 세지 않는다', () => {
  const s = H.scan('<html><head><!-- <title>가짜</title> --><title>진짜 제목</title></head><body><!-- <script type="application/ld+json">{"@type":"Dentist"}</script> --><p>본문</p></body></html>');
  assert.equal(s.title, '진짜 제목');
  assert.equal(s.jsonld.length, 0);
  assert.equal(s.bodyText, '본문');
});

test('script·style·noscript 속 글자는 본문이 아니다', () => {
  const s = H.scan('<body><script>var a="<p>가짜 본문</p>";</script><style>.a{content:"스타일"}</style><noscript>자바스크립트를 켜세요</noscript><p>진료시간 안내</p></body>');
  assert.equal(s.bodyText, '진료시간 안내');
  assert.equal(s.scriptCount, 1);
});

test('속성값 속 > 에서 태그가 잘리지 않는다', () => {
  const s = H.scan('<body><a href="/a?x=1>2" title="a > b">의료진 소개</a><img src="a.png" alt="원장 사진"><img src="b.png"></body>');
  assert.deepEqual(s.anchors, [{ href: '/a?x=1>2', text: '의료진 소개' }]);
  assert.deepEqual(s.images, { total: 2, withAlt: 1 });
});

test('head의 글자는 본문 글자로 세지 않는다', () => {
  const s = H.scan('<html><head><title>제목 글자</title><meta name="description" content="설명 글자"></head><body></body></html>');
  assert.equal(s.bodyText, '');
  assert.equal(H.countChars(s.bodyText), 0);
  assert.equal(s.metas[0].content, '설명 글자');
});

test('JSON-LD: 배열과 @graph 안의 의료기관을 찾는다', () => {
  const s = H.scan('<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["MedicalClinic","LocalBusiness"],"name":"예시의원","telephone":"02-000-0000"}]}</script><script type="application/ld+json">[{"@type":"FAQPage"}]</script><script type="application/ld+json">{깨짐</script>');
  const types = s.jsonld.flatMap((x) => [].concat(x['@type']));
  assert.ok(types.includes('MedicalClinic')); assert.ok(types.includes('FAQPage'));
  assert.equal(s.jsonldBroken, 1);
});

test('Microdata·RDFa도 구조화 정보로 잡는다', () => {
  assert.equal(H.scan('<div itemscope itemtype="https://schema.org/Dentist"></div>').hasMicrodata, true);
  assert.deepEqual(H.scan('<div itemscope itemtype="https://schema.org/Dentist"></div>').microTypes, ['Dentist']);
  assert.equal(H.scan('<div vocab="https://schema.org/" typeof="Physician"></div>').hasRdfa, true);
});

test('제목·줄 나눔·엔티티', () => {
  const s = H.scan('<body><h1>라온&nbsp;피부과</h1><ul><li>보톡스 &amp; 필러</li><li>리프팅</li></ul><h2>자주 묻는 질문</h2></body>');
  assert.deepEqual(s.headings, [{ level: 1, text: '라온 피부과' }, { level: 2, text: '자주 묻는 질문' }]);
  assert.deepEqual(s.lines, ['라온 피부과', '보톡스 & 필러', '리프팅', '자주 묻는 질문']);
});

test('frameset 홈페이지는 frame 주소를 돌려준다', () => {
  const s = H.scan('<html><frameset rows="*"><frame src="/main.php"></frameset></html>');
  assert.deepEqual(s.frames, [{ kind: 'frame', src: '/main.php' }]);
  assert.equal(s.bodyText, '');
});

test('EUC-KR 홈페이지의 한글을 읽는다(헤더·meta·선언 없음 세 경우)', () => {
  const euc = Buffer.from([0x3c, 0x70, 0x3e, 0xc1, 0xf8, 0xb7, 0xe1, 0xbd, 0xc3, 0xb0, 0xa3, 0x3c, 0x2f, 0x70, 0x3e]); // <p>진료시간</p>
  assert.equal(H.decodeHtml(euc, 'text/html; charset=EUC-KR').text, '<p>진료시간</p>');
  const meta = Buffer.concat([Buffer.from('<meta http-equiv="Content-Type" content="text/html; charset=ks_c_5601-1987">'), euc]);
  assert.ok(H.decodeHtml(meta, 'text/html').text.includes('진료시간'));
  const long = Buffer.concat(Array.from({ length: 40 }, () => euc));
  const g = H.decodeHtml(long, '');
  assert.ok(g.text.includes('진료시간')); assert.equal(g.charset, 'euc-kr');
});

test('모르는 인코딩은 null(확인 못 함), UTF-8은 그대로', () => {
  assert.equal(H.decodeHtml(Buffer.from('abc'), 'text/html; charset=x-unknown-zzz'), null);
  assert.equal(H.decodeHtml(Buffer.from('<p>한글</p>'), 'text/html; charset=utf-8').text, '<p>한글</p>');
  assert.equal(H.decodeHtml('문자열', ''), null);
});

test('글자 수는 글자와 숫자만 센다', () => {
  assert.equal(H.countChars('진료 시간: 09~18시!'), 9);
});
