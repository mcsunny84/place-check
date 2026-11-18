'use strict';
// 점수(100점)와 「이걸 고치면」 사다리. 원칙: 확인된 것에만 점수를 준다. 확인 못 한 것은 0점이되 "문제"로 부르지 않는다.
const GRADES = [[85, 'A'], [70, 'B'], [55, 'C'], [0, 'D']];
// 배점은 2026-11-18 실전 시험(의원 홈페이지 30여 곳)으로 맞췄다. 문만 열려 있어도 받는 점수를 줄이고, 병원마다 차이가 나는 항목에 무게를 뒀다.
const TEXT_STEPS = [[1500, 12], [800, 9], [400, 6], [150, 3]];
const PAGE_STEPS = [[50, 10], [20, 7], [5, 4], [1, 2]];
const SPEED_STEPS = [[1000, 2], [2500, 1]];

const step = (v, steps, dir = 'ge') => { for (const [th, pts] of steps) if (dir === 'ge' ? v >= th : v < th) return pts; return 0; };
const gradeOf = (s) => GRADES.find(([min]) => s >= min)[1];

function scoreAudit(a) {
  const items = [];
  const ladder = [];
  const add = (id, label, got, max, state, detail) => items.push({ id, label, got, max, state, detail });
  const fix = (id, gain, title, how, need) => { if (gain > 0) ladder.push({ id, gain, title, how, need }); };

  // 1. 4대 AI 검색 로봇 (16)
  const doorIds = ['chatgpt', 'claude', 'gemini', 'perplexity'];
  const unknownDoors = doorIds.every((k) => a.doors[k].state === 'unknown');
  let ai = 0; const shut = []; const half = [];
  for (const k of doorIds) { const d = a.doors[k]; if (d.state === 'open') ai += 4; else if (d.state === 'half') { ai += 2; half.push(d.label); } else if (d.state === 'shut') shut.push(d.label); }
  add('ai', '4대 AI 검색 로봇 출입', ai, 16, unknownDoors ? 'unknown' : shut.length ? 'bad' : half.length ? 'warn' : 'good',
    unknownDoors ? '출입 규칙 파일(robots.txt)을 확인하지 못했어요' : shut.length ? `${shut.join(' · ')} 검색 로봇이 막혀 있어요` : half.length ? '제미나이 이용 설정이 꺼져 있어요' : '4곳 모두 들어올 수 있어요');
  if (!unknownDoors) {
    if (shut.length) fix('ai', shut.length * 4, `${shut.join(' · ')} 출입 열기`, '출입 규칙 파일(robots.txt)에서 이 AI의 검색 로봇을 막는 줄을 고쳐요.', '홈페이지 서버 접속 권한이 필요해요. 줄을 잘못 지우면 네이버·구글 검색까지 막힐 수 있어요.');
    if (half.length) fix('gemini', 2, '제미나이 이용 설정 켜기', '출입 규칙 파일에서 Google-Extended를 막는 줄을 고쳐요.', '홈페이지 서버 접속 권한이 필요해요.');
  }

  // 2. 읽을 글자 (16) — 메뉴·버튼 글자가 아니라 설명 문장을 센다
  const img = a.text.images;
  const ratio = img.total ? img.withAlt / img.total : (a.text.chars >= 300 ? 1 : 0); // 이미지도 글자도 없는 빈 화면은 0점
  const altPts = ratio >= 0.8 ? 4 : ratio >= 0.5 ? 2 : 0;
  const textPts = step(a.text.prose, TEXT_STEPS);
  add('text', '읽을 글자', textPts + altPts, 16, textPts >= 9 ? (altPts >= 2 ? 'good' : 'warn') : 'bad',
    `첫 화면의 설명 문장 ${a.text.prose.toLocaleString('ko-KR')}자(메뉴·버튼까지 합치면 ${a.text.chars.toLocaleString('ko-KR')}자), 이미지 ${img.total}장 중 설명이 있는 것 ${img.withAlt}장`);
  fix('text', 12 - textPts + (img.total ? 0 : 4 - altPts), a.text.chars < 300 ? (img.total ? '이미지 속 글자를 진짜 글자로 바꾸기' : '빈 화면으로 보이는 첫 화면에 글자 넣기') : '첫 화면에 병원을 설명하는 문장 넣기',
    a.text.chars < 300 ? (img.total ? '시술 이름, 설명, 진료 안내를 이미지가 아니라 글자로 넣어야 AI가 읽어 가요.' : '화면을 나중에 그려 넣는 방식이라 AI 로봇에게는 빈 화면으로 보여요. 처음부터 글자가 담긴 화면을 내보내도록 바꿔야 해요.') : '지금 첫 화면 글자는 대부분 메뉴 이름이에요. 어떤 진료를 누가 어떻게 하는 병원인지 문장으로 적어야 AI가 답변에 옮겨 가요.',
    '홈페이지 관리자 권한과 페이지 다시 제작이 필요해요. 바뀐 문구는 의료광고 기준 확인이 필요해요.');
  if (img.total) fix('alt', 4 - altPts, '이미지마다 설명 글 달기', `설명이 없는 이미지 ${img.total - img.withAlt}장에 무엇을 보여 주는 이미지인지 한 줄씩 적어요.`, '홈페이지 관리자 화면에서 이미지마다 입력해야 해요. 장 수가 많으면 시간이 걸려요.');

  // 3. 병원 구조화 정보 (18)
  const s = a.structured;
  const typePts = s.medical ? 4 : s.business ? 2 : 0;
  const fieldPts = !s.any ? 0 : (s.fields.name ? 1 : 0) + (s.fields.address ? 1 : 0) + (s.fields.telephone ? 1 : 0) + (s.fields.hours ? 3 : 0);
  const sdPts = (s.any ? 2 : 0) + typePts + fieldPts + (s.person ? 3 : 0) + (s.sameAs ? 3 : 0);
  const sdMiss = [!s.medical && '병원 종류', !(s.fields.address && s.fields.telephone) && '주소·전화', !s.fields.hours && '진료시간', !s.person && '의료진', !s.sameAs && '공식 채널 연결'].filter(Boolean);
  add('structured', '병원 구조화 정보', sdPts, 18, sdPts >= 15 ? 'good' : s.any ? 'warn' : 'bad',
    !s.any ? '병원 정보를 AI가 알아보는 형식으로 넣은 것을 찾지 못했어요' : sdMiss.length ? `형식은 있는데 빠진 것: ${sdMiss.join(' · ')}` : '병원 종류부터 의료진까지 모두 들어 있어요');
  fix('structured', 18 - sdPts, s.any ? `구조화 정보에 ${sdMiss.slice(0, 3).join(' · ')} 채우기` : '병원 정보를 AI가 알아보는 형식으로 넣기', '병원 종류, 주소, 전화, 진료시간, 의료진, 네이버 플레이스 같은 공식 채널 주소를 정해진 형식(구조화 정보)으로 홈페이지 코드에 넣어요. AI가 "이 홈페이지가 그 병원"이라고 확인하는 근거예요.', '홈페이지 코드를 수정할 권한과 개발자가 필요해요.');

  // 4. 자주 묻는 질문 (12)
  const fq = a.faq;
  const faqText = fq.questions >= 5 ? 6 : fq.questions >= 3 ? 4 : fq.questions >= 1 ? 2 : 0;
  const faqPts = faqText + (fq.schema ? 6 : 0);
  add('faq', '자주 묻는 질문', faqPts, 12, faqPts >= 10 ? 'good' : faqPts > 0 ? 'warn' : 'unknown',
    fq.questions ? `질문 글 ${fq.questions}개를 찾았어요${fq.schema ? '' : '. AI가 알아보는 FAQ 표시는 없어요'}` : '질문과 답으로 된 글을 찾지 못했어요');
  fix('faq', 12 - faqPts, fq.questions >= 5 ? '질문과 답을 AI가 알아보는 형식으로 표시하기' : '환자들이 실제로 묻는 질문과 답 넣기',
    fq.questions >= 5 ? '이미 있는 질문과 답에 FAQ 구조화 표시를 붙여요.' : '"시술 뒤 며칠 뒤에 세안해도 되나요" 같은 질문과 원장님의 답을 글자로 올리고, FAQ 구조화 표시를 붙여요.',
    fq.questions >= 5 ? '홈페이지 코드를 수정할 권한과 개발자가 필요해요.' : '질문 15~20개 정리와 원장님 답변 작성, 의료광고 기준 확인, 코드 수정이 필요해요.');

  // 5. 진료별 페이지 (10)
  const pg = a.pages;
  const pagePts = pg.sitemap === 'found' ? step(pg.count, PAGE_STEPS) : pg.internalLinks >= 20 ? 2 : 0;
  add('pages', '진료별 페이지', pagePts, 10, pagePts >= 7 ? 'good' : pagePts > 0 ? 'warn' : pg.sitemap === 'unknown' ? 'unknown' : 'bad',
    pg.sitemap === 'found' ? `사이트맵에서 페이지 ${pg.count.toLocaleString('ko-KR')}개를 확인했어요` : pg.sitemap === 'unknown' ? '사이트맵을 확인하지 못했어요' : '사이트맵이 없어서 페이지를 셀 수 없었어요');
  fix('pages', 10 - pagePts, pg.sitemap === 'found' ? '진료·시술마다 페이지를 따로 만들기' : '사이트맵 만들고 진료별 페이지 등록하기',
    pg.sitemap === 'found' ? '진료 과목과 시술마다 설명 페이지를 하나씩 두어야 AI가 그 질문에 맞는 페이지를 찾아가요.' : '홈페이지의 모든 페이지 주소를 적은 목록(사이트맵)을 만들고, 진료·시술마다 페이지를 따로 둬요.',
    '진료 과목 수만큼 페이지를 새로 만들어야 해요. 문구는 의료광고 기준 확인이 필요해요.');

  // 6. 의료진 정보 (12)
  const dc = a.doctors;
  const docPts = dc.verified ? 12 : dc.link ? 3 : 0;
  add('doctors', '의료진 정보', docPts, 12, dc.verified ? 'good' : dc.link ? 'warn' : 'unknown',
    dc.verified ? '전문의 여부와 약력을 글자로 확인했어요' : dc.link ? '의료진 페이지는 있는데 전문의 여부·약력을 글자로 찾지 못했어요' : '의료진 소개를 찾지 못했어요');
  fix('doctors', 12 - docPts, '의료진 약력을 글자로 올리기', '전문의 여부, 학력, 경력, 학회 활동을 이미지가 아니라 글자로 적어요. AI가 병원을 소개할 때 가장 먼저 찾는 내용이에요.', dc.link ? '의료진 페이지를 다시 만들어야 해요. 경력 표기는 의료광고 기준 확인이 필요해요.' : '의료진 페이지를 새로 만들어야 해요. 경력 표기는 의료광고 기준 확인이 필요해요.');

  // 7. 기본 정보 글자 (6)
  const b = a.basic;
  const basicPts = (b.phone ? 2 : 0) + (b.address ? 2 : 0) + (b.hours ? 2 : 0);
  const missing = [!b.address && '주소', !b.phone && '전화번호', !b.hours && '진료시간'].filter(Boolean);
  add('basic', '주소·전화·진료시간', basicPts, 6, basicPts === 6 ? 'good' : basicPts > 0 ? 'warn' : 'unknown', missing.length ? `${missing.join(' · ')}을(를) 글자로 찾지 못했어요` : '세 가지 모두 글자로 있어요');
  fix('basic', 6 - basicPts, `${missing.join(' · ')} 글자로 적기`, '이미지 안이 아니라 글자로 적어야 AI가 "몇 시까지 해요?" 같은 질문에 답할 수 있어요.', '홈페이지 관리자 화면에서 고칠 수 있어요. 어렵지 않아요.');

  // 8. 속도·모바일 (4)
  const spPts = step(a.speed.ms, SPEED_STEPS, 'lt') + (a.speed.viewport ? 2 : 0);
  add('speed', '속도·모바일', spPts, 4, spPts >= 3 ? 'good' : 'warn', `첫 화면을 받는 데 ${(a.speed.ms / 1000).toFixed(1)}초${a.speed.viewport ? '' : ', 모바일 화면 설정 없음'}`);
  fix('speed', 4 - spPts, a.speed.viewport ? '첫 화면 뜨는 속도 줄이기' : '모바일 화면 설정 넣고 속도 줄이기', '첫 화면의 큰 이미지와 불필요한 스크립트를 줄여요.', '이미지 다시 저장, 서버 설정 변경이 필요해요. 개발자가 봐야 해요.');

  // 9. 기본 위생 (6)
  const h = a.hygiene; const indexable = !(a.noindex.all || a.noindex.google || a.noindex.naver);
  const hyPts = (h.https ? 1 : 0) + (h.title ? 1 : 0) + (h.description ? 1 : 0) + (h.canonical ? 1 : 0) + (h.sitemap ? 1 : 0) + (indexable ? 1 : 0);
  const hyMiss = [!h.https && '보안 주소(https)', !h.title && '페이지 제목', !h.description && '페이지 설명', !h.canonical && '대표 주소 표시', !h.sitemap && '사이트맵'].filter(Boolean);
  add('hygiene', '기본 설정', hyPts, 6, hyPts >= 5 ? 'good' : 'warn', hyMiss.length ? `빠진 것: ${hyMiss.join(' · ')}` : '빠진 것이 없어요');
  const easy = hyMiss.every((m) => m === '페이지 제목' || m === '페이지 설명');
  fix('hygiene', 6 - hyPts - (indexable ? 0 : 1), `${hyMiss.slice(0, 3).join(' · ')} 넣기`, '검색 결과와 AI가 페이지를 구분할 때 쓰는 기본 정보예요.', easy ? '홈페이지 관리자 화면에서 10분이면 돼요.' : '일부는 홈페이지 코드와 서버 설정을 고쳐야 해요.');

  const score = items.reduce((n, x) => n + x.got, 0);
  ladder.sort((x, y) => y.gain - x.gain);
  const after = Math.min(100, score + ladder.reduce((n, x) => n + x.gain, 0));

  // 검색 자체가 막힌 상태는 점수와 별개로 맨 위에 알린다
  const critical = [];
  if (a.engines.naver === false) critical.push('네이버 검색 로봇이 막혀 있어요');
  if (a.engines.google === false) critical.push('구글 검색 로봇이 막혀 있어요');
  if (!indexable) critical.push('검색 결과에 넣지 말라는 설정(noindex)이 켜져 있어요');

  const trainingOff = doorIds.filter((k) => a.doors[k].training === false).map((k) => a.doors[k].label);
  return { score, grade: gradeOf(score), items, ladder, after, critical, trainingOff };
}

// "AI가 읽은 것" 표 — 화면의 못 읽음 목록
function readList(a) {
  const yn = (v) => (v ? 'yes' : 'no');
  return [
    { label: '병원 이름', state: yn(a.hygiene.title || a.structured.fields.name) },
    { label: '주소 · 전화번호', state: yn(a.basic.address && a.basic.phone) },
    { label: '진료시간 · 휴진일', state: yn(a.basic.hours) },
    { label: '진료 · 시술별 설명', state: yn(a.pages.sitemap === 'found' && a.pages.count >= 15) },
    { label: '의료진 · 전문의 여부', state: yn(a.doctors.verified) },
    { label: '자주 묻는 질문', state: yn(a.faq.questions >= 3) },
  ];
}

module.exports = { scoreAudit, readList, gradeOf, GRADES };
