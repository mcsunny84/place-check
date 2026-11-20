'use strict';
// 챗GPT 검색 실측 — 병원과 상관없는 "지역 + 진료과" 추천 질문을 OpenAI 검색 API에 물어,
// 우리 병원이 나오는지·누가 대신 나오는지·어느 사이트를 근거로 댔는지 본다. (설계 v2 6-1~6-3절, 8-1절)
// 같은 질문은 지역 공유 결과로 7일 동안 다시 쓴다(병원 이름이 질문에 없으니 누가 물어도 같은 질문이다).

const MODEL = () => process.env.HOSPITAL_OPENAI_MODEL || 'gpt-6.2-sol';
const PRICE = { in: 2 / 1e6, out: 10 / 1e6, search: 0.01 }; // gpt-6.2-sol 단가(달러, 2026-11-19 확인)
const EST_KRW = 60; // 실측 질문당 약 58원(평균)
const MAX_OUT = 1200; // 답 길이 상한(토큰) — 한 질문 최대 비용을 묶는다
const RESERVE_KRW = 110; // 예약은 최대치로: 검색 결과 약 1만 토큰 + 답 1,200토큰 + 검색 1회
const QA_TTL_MS = 7 * 24 * 3600 * 1000;

// 진료과 판정(네이버 분류 글자) → 대표 시술 2개
const DEPTS = [
  [/치과/, '치과', ['임플란트', '치아교정']],
  [/피부/, '피부과', ['리프팅', '여드름 치료']],
  [/성형/, '성형외과', ['눈성형', '코성형']],
  [/안과/, '안과', ['라식', '백내장 수술']],
  [/한의/, '한의원', ['추나', '교통사고 한방치료']],
  [/정형/, '정형외과', ['도수치료', '허리 디스크']],
  [/산부인과|여성의원/, '산부인과', ['산전 검사', '자궁경부암 검사']],
  [/이비인후/, '이비인후과', ['비염 치료', '코골이']],
  [/비뇨/, '비뇨의학과', ['전립선', '요로결석']],
  [/통증/, '통증의학과', ['신경차단술', '어깨 통증']],
];
function deptOf(category) {
  const c = String(category || '');
  for (const [re, name, procs] of DEPTS) if (re.test(c)) return { dept: name, procs };
  return null;
}

// 네이버 지번 주소("서울 노원구 상계동 …")에서 사람들이 검색에 쓰는 지역 이름 두 개를 뽑는다.
const METRO = /^(서울|부산|대구|인천|광주|대전|울산|세종)/;
const SHORT_GU = /^(중|동|서|남|북)구$/;
function regionsOf(address) {
  const first = String(address || '').split('·')[0].trim();
  const t = first.split(/\s+/);
  if (t.length < 2) return [];
  let r1 = null, r2 = null;
  const bare = (x, suf) => x.replace(new RegExp(suf + '$'), '');
  if (METRO.test(t[0])) {
    if (/구$/.test(t[1])) r1 = SHORT_GU.test(t[1]) ? bare(t[0], '(특별|광역)?시') + ' ' + t[1] : bare(t[1], '구');
    else if (/군$/.test(t[1])) r1 = t[1];
  } else {
    if (/시$/.test(t[1])) r1 = bare(t[1], '시');
    if (t[2] && /구$/.test(t[2]) && !SHORT_GU.test(t[2])) r1 = bare(t[2], '구'); // 성남 분당구 → 분당
    else if (/군$/.test(t[1])) r1 = t[1];
  }
  // 역삼1동·종로3가처럼 숫자가 붙은 동도 받는다(질문에는 숫자를 뗀 이름)
  const dong = t.slice(1).find((x) => /^[가-힣]+\d*(동|읍|면|가)$/.test(x) && !/구$|시$|군$/.test(x));
  if (dong) r2 = dong.replace(/\d+동$/, () => '동'); // 역삼1동 → 역삼동, 종로3가는 그대로
  return [r1, r2].filter((x, i, a) => x && a.indexOf(x) === i);
}
// 검색 위치(OpenAI user_location): 광역시·특별시만 이름을 안다. 나머지는 나라만 준다.
const CITY = { 서울: 'Seoul', 부산: 'Busan', 대구: 'Daegu', 인천: 'Incheon', 광주: 'Gwangju', 대전: 'Daejeon', 울산: 'Ulsan', 세종: 'Sejong' };
function cityOf(address) { const m = String(address || '').trim().match(METRO); return m ? CITY[m[1]] : null; }

const cleanRegion = (s) => String(s || '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 12);

// 질문 5개: 첫 지역 3개 + 둘째 지역 2개 (지역이 하나면 그 지역으로 5개)
function buildQuestions(regions, d) {
  const [r1, r2] = regions;
  const dept = d.dept, [p1, p2] = d.procs;
  const a = [`${r1} ${dept} 추천해줘`, `${r1} ${p1} 잘하는 곳 알려줘`, `${r1} 야간 진료하는 ${dept} 알려줘`];
  const b = r2 ? [`${r2} ${dept} 추천해줘`, `${r2} ${p2} 잘하는 곳 알려줘`] : [`${r1} ${p2} 잘하는 곳 알려줘`, `${r1} ${dept} 잘하는 곳 어디야?`];
  return a.concat(b);
}

// ---------- 답에서 병원 이름 뽑기 ----------
const SUFFIX = '(?:치과의원|치과병원|피부과의원|성형외과의원|안과의원|한의원|의원|병원|치과|피부과|성형외과|안과|클리닉|정형외과|산부인과|이비인후과|비뇨의학과|통증의학과|내과)';
const NAME_RE = new RegExp('[가-힣A-Za-z0-9&]{1,20}' + SUFFIX + '(?!학회|전문의|의사회|협회|학과|의사)', 'g');
const ENDS_SUFFIX = new RegExp(SUFFIX + '$');
const GLUED_BRANCH = new RegExp('(' + SUFFIX + ')[가-힣]{1,8}점$');
const GENERIC = /^(치과의원|피부과의원|성형외과의원|안과의원|피부과|치과|성형외과|안과|한의원|의원|병원|클리닉|대학병원|종합병원|치과병원|피부과병원|성형외과병원|전문병원|동네병원|동네치과|개인병원|정형외과|산부인과|이비인후과|내과|교정치과|소아치과|미용피부과|일반피부과)$/;
// 일반 말로 시작하는 덩어리("근처피부과", "가까운치과")만 거른다. '이안치과'처럼 병원 이름 첫 글자는 건드리지 않는다.
const GENERIC_HEAD = /^(대한|한국|근처|주변|인근|추천|종합|일반|동네|개인|어느|이런|이곳|이번|다른|좋은|가까운|유명한|해당|여러|모든|대형|소형|야간|주말|가는|있는|하는|찾는|많은)/;

function keyOf(name) {
  return String(name || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}&]/gu, '')
    .replace(/(치과|피부과|성형외과|안과)의원$/, (m, g) => g).replace(/치과병원$/, '치과').replace(/의원$/, '')
    .toLowerCase();
}
// 지점 표시를 뗀 이름의 핵심("소담봄의원 홍대" → "소담봄", "가나의원강남점" → "가나")
function coreOf(name) {
  const raw = String(name || '').trim();
  const parts = raw.split(/\s+/);
  const head = parts.length > 1 && ENDS_SUFFIX.test(parts[0]) ? parts[0]
    : raw.replace(/\s+[가-힣A-Za-z0-9]+점$/, '').replace(GLUED_BRANCH, (m, g) => g);
  const k = keyOf(head);
  return k.replace(/(치과|피부과|성형외과|안과|한의원|정형외과|병원|클리닉)$/, '') || k;
}

// 원문 순서 그대로 병원 이름을 뽑는다(굵은 글씨 여부와 상관없이)
function extractClinics(text) {
  const t = String(text || '').replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\]\([^)]*\)/g, ']').replace(/\*\*/g, ' ');
  const found = []; const seen = new Set();
  for (const m of t.matchAll(NAME_RE)) {
    const n = m[0];
    if (GENERIC.test(n) || GENERIC_HEAD.test(n)) continue;
    const k = keyOf(n);
    if (k.length < 2 || seen.has(k)) continue;
    seen.add(k); found.push({ name: n, key: k });
  }
  return found;
}

const SITES = [
  [/modoodoc\.com/, '모두닥'], [/cashdoc\.me/, '캐시닥'], [/goodoc\.co\.kr/, '굿닥'], [/hidoc\.co\.kr/, '하이닥'],
  [/ddocdoc\.com/, '똑닥'], [/doctornow\.co\.kr/, '닥터나우'], [/gangnamunni\.com/, '강남언니'], [/babitalk\.com/, '바비톡'],
  [/hira\.or\.kr/, '심평원'], [/blog\.naver\.com|m\.blog\.naver\.com/, '네이버 블로그'], [/tistory\.com/, '티스토리'],
  [/place\.naver\.com|map\.naver\.com/, '네이버 지도'], [/google\.[a-z.]+\/maps|maps\.google/, '구글 지도'],
  [/dentstat|dentalroad|medifect|jucal|성형외과노트/i, '시술 비교 글'],
  [/youtube\.com|youtu\.be/, '유튜브'], [/medi-spec\.com/, '메디스펙(전문의 정보)'], [/my-doctor\.io/, '마이닥터'],
  [/\.or\.kr(\/|$)/, '학회·협회'], [/daangn\.com/, '당근'],
  [/dentmapkorea|dentalindexing|kdermzip|dermato-hub|kbizin|clinics\.seoul\.kr/, '병원 목록 사이트'],
  [/instagram\.com/, '인스타그램'], [/namu\.wiki/, '나무위키'],
];
function sourceKind(url, ourHost) {
  let h = ''; try { h = new URL(url).hostname.replace(/^www\./, ''); } catch { return '기타'; }
  if (ourHost && (h === ourHost || h.endsWith('.' + ourHost))) return '우리 홈페이지';
  for (const [re, label] of SITES) if (re.test(url)) return label;
  return /\.(co\.kr|com|kr|net)$/.test(h) && /dental|skin|clinic|derma|ps|eye|치과|피부/.test(h) ? '병원 홈페이지' : '기타';
}
const hostOfUrl = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const canonHost = (h) => (h ? hostOfUrl(/^https?:/.test(h) ? h : 'https://' + h) : null);

// ---------- OpenAI 호출 ----------
// 결과: { ok, text, sources, krw } / 실패 { ok:false, reason, charged?(돈이 나갔을 수 있음), krw?(확인된 금액) }
async function askOpenAI(q, city, deps) {
  const key = deps.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: 'no_key' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), deps.timeoutMs || 60_000);
  try {
    const res = await deps.fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), input: q, max_tool_calls: 1, max_output_tokens: MAX_OUT,
        tools: [{ type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate', country: 'KR', ...(city ? { city } : {}), timezone: 'Asia/Seoul' } }] }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) return { ok: false, reason: 'api_' + res.status, charged: res.status >= 500 };
    let text = '', searches = 0; const sources = []; const seen = new Set();
    for (const o of j.output || []) {
      if (o.type === 'web_search_call') searches++;
      if (o.type === 'message') for (const c of o.content || []) if (c.type === 'output_text') {
        text += c.text;
        for (const a of c.annotations || []) if (a.url) { const u = a.url.replace(/[?&]utm_source=openai$/, ''); if (!seen.has(u)) { seen.add(u); sources.push({ url: u, title: String(a.title || '').slice(0, 120) }); } }
      }
    }
    const usd = (j.usage?.input_tokens || 0) * PRICE.in + (j.usage?.output_tokens || 0) * PRICE.out + searches * PRICE.search;
    const krw = Math.round(usd * deps.usdKrw);
    // 실패·거절·빈 답은 "안 나옴"이 아니라 "못 물어봄"이다. 결과를 지어내지 않는다.
    if (j.status && j.status !== 'completed' && j.status !== 'incomplete') return { ok: false, reason: 'api_' + j.status, krw, charged: true };
    if (text.trim().length < 20) return { ok: false, reason: 'empty', krw, charged: true };
    return { ok: true, text: text.slice(0, 6000), sources: sources.slice(0, 12), krw };
  } catch (e) { return { ok: false, reason: e.name === 'AbortError' ? 'timeout' : 'network', charged: true }; } finally { clearTimeout(timer); }
}

// 한 질문의 결과를 우리 병원 기준으로 읽는다
function judge(ans, ours) {
  const list = extractClinics(ans.text);
  const full = keyOf(ours.name), core = coreOf(ours.name);
  // 같은 병원 = 이름이 같거나, 지점 표시를 뗀 핵심 이름이 똑같을 때만(라온치과 ≠ 라온미소치과)
  const rank = list.findIndex((c) => c.key === full || (core.length >= 2 && coreOf(c.name) === core));
  const ourSource = ours.host ? ans.sources.some((s) => sourceKind(s.url, ours.host) === '우리 홈페이지') : false;
  return { found: rank >= 0, rank: rank >= 0 ? rank + 1 : null, others: list.filter((_, i) => i !== rank).slice(0, 6).map((c) => c.name), ourSource };
}

const INFLIGHT = new Map(); // 같은 유료 질문이 동시에 여러 번 나가지 않게

// probe({ name, address, category, regions?, host? }, deps) → 결과
// deps: { fetch, env, usdKrw, cache: {get(k), set(k,v)}, budget: {reserve(krw)→bool, settle(actual, reserved)}, now, inflight? }
async function runProbe(input, deps) {
  const d = deptOf(input.dept || input.category);
  if (!d) return { ok: false, reason: 'no_dept' };
  const regions = (Array.isArray(input.regions) && input.regions.length ? input.regions.map(cleanRegion) : regionsOf(input.address)).filter(Boolean).slice(0, 2);
  if (!regions.length) return { ok: false, reason: 'no_region' };
  const questions = buildQuestions(regions, d);
  const city = cityOf(input.address);
  const inflight = deps.inflight || INFLIGHT;
  const now = deps.now();
  let spent = 0, budgetHit = false, failed = 0;
  const ask = (q) => askCached(q, city, inflight, now, deps);
  const nm = String(input.name || '').trim();
  const introQ = (nm.split(/\s+/).length > 1 ? nm : regions[0] + ' ' + nm) + ' 어때?'; // 지점 이름이 붙어 있으면 지역을 또 붙이지 않는다
  const introJob = ask(introQ); // A: 병원 이름을 넣은 질문 1개(추천률에는 넣지 않는다)
  const answers = await Promise.all(questions.map(async (q) => {
    const r = await ask(q);
    if (r.budget) budgetHit = true;
    if (r.skipped) { if (!r.budget) failed++; return { q, skipped: r.skipped }; }
    spent += r.spent;
    return r.row;
  }));
  const done = answers.filter((a) => !a.skipped);
  if (!done.length) return { ok: false, reason: budgetHit ? 'budget' : failed ? 'api' : 'error' };
  const ours = { name: input.name, host: canonHost(input.host) };
  const tally = new Map(); const kinds = new Map();
  const rows = answers.map((a) => {
    if (a.skipped) return { q: a.q, state: 'skipped' };
    const j = judge(a, ours);
    for (const n of j.others) { const k = keyOf(n); const t = tally.get(k) || { name: n, n: 0 }; t.n++; tally.set(k, t); }
    for (const s of a.sources) { const k = sourceKind(s.url, ours.host); kinds.set(k, (kinds.get(k) || 0) + 1); }
    return { q: a.q, state: j.found ? 'found' : 'missing', rank: j.rank, others: j.others.slice(0, 3), ourSource: j.ourSource, at: a.at,
      text: a.text, sources: a.sources.map((s) => ({ ...s, kind: sourceKind(s.url, ours.host) })) };
  });
  const asked = rows.filter((r) => r.state !== 'skipped');
  const hits = asked.filter((r) => r.state === 'found').length;
  const rivals = [...tally.values()].sort((x, y) => y.n - x.n).slice(0, 5).map((t) => ({ name: t.name, n: t.n }));
  const measured = Math.min(...asked.map((r) => r.at));
  const ir = await introJob;
  if (!ir.skipped) spent += ir.spent;
  const intro = ir.skipped ? null : { q: introQ, ...readIntro(ir.row, ours) };
  return {
    ok: true, dept: d.dept, regions, model: MODEL(), measured_at: new Date(measured).toISOString(),
    asked: asked.length, hits, rows, rivals,
    sources: [...kinds.entries()].sort((x, y) => y[1] - x[1]).map(([kind, n]) => ({ kind, n })),
    ourSourceUsed: asked.some((r) => r.ourSource), homeKnown: !!ours.host, spent_krw: spent, partial: asked.length < rows.length,
    intro, compare: compareTop(asked, ours, hits, rivals, d.dept),
  };
}

// 질문 하나: 7일 공유 보관분 → 같은 질문이 돌고 있으면 거기에 붙기 → 새로 묻기(예산 예약)
async function askCached(q, city, inflight, now, deps) {
  const ck = 'qa|' + (city || 'KR') + '|' + q;
  const hit = deps.cache.get(ck);
  if (hit && now - hit.at < QA_TTL_MS) return { spent: 0, row: { q, at: hit.at, shared: true, ...hit.ans } };
  let job = inflight.get(ck), mine = false;
  if (!job) {
    if (!deps.budget.reserve(RESERVE_KRW)) return { skipped: 'budget', budget: true };
    mine = true;
    job = askOpenAI(q, city, deps).then((ans) => {
      // 확인된 금액이 있으면 그대로, 돈이 나갔는지 모르면(시간 초과 등) 예약액 그대로 쓴 것으로 친다
      deps.budget.settle(ans.krw != null ? ans.krw : ans.charged ? RESERVE_KRW : 0, RESERVE_KRW);
      if (ans.ok) deps.cache.set(ck, { at: now, ans: { text: ans.text, sources: ans.sources } });
      return ans;
    }).finally(() => inflight.delete(ck));
    inflight.set(ck, job);
  }
  const ans = await job;
  if (!ans.ok) return { skipped: ans.reason };
  return { spent: mine ? ans.krw : 0, row: { q, at: now, shared: !mine, text: ans.text, sources: ans.sources } };
}

// ---------- A. 병원 이름으로 물었을 때의 소개 ----------
// 맞고 틀림은 판정하지 않는다. AI가 "모른다·확인 안 된다"고 한 문장과, 같이 권한 다른 병원만 짚는다.
const NEG = /(확인되지 않|확인이 어(렵|려)|확인하기 어(렵|려)|확인할 수 없|찾기 어(렵|려)|찾을 수 없|찾지 못|나와 있지 않|공개되(어 있)?지 않|명시되(어 있)?지 않|알려지지 않|정보가 (없|부족|많지 않|적)|자료가 (없|부족|많지 않)|확인이 필요|(판단|평가|말|단정)하기 어(렵|려)|알기 어(렵|려))/;
const ADVICE = /(해 ?보세요|해 ?보시|물어보|문의하세요|챙기세요|비교해 보)/;
const TOPICS = [['전문의·의료진', /전문의|의료진|원장|의사|전문 ?과목/], ['가격·비용', /가격|비용|요금|금액|이벤트가/], ['진료시간', /진료 ?시간|운영 ?시간|야간|주말|휴진|영업/], ['대표 시술·진료', /시술|진료 ?항목|진료 ?과목|치료|장비|전문 분야/], ['후기', /후기|리뷰|평점|평가/], ['예약·위치', /예약|주차|위치|찾아가/]];
const plain = (t) => String(t || '').replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/[ \t]+\n/g, '\n').trim();
function readIntro(a, ours) {
  const text = plain(a.text).slice(0, 1800);
  const sentences = text.split(/(?<=[.!?。])\s+|\n+/).map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim()).filter((x) => x.length > 4);
  const gaps = []; const marks = [];
  for (const sn of sentences) {
    if (!NEG.test(sn) || (ADVICE.test(sn) && !/(찾지 못|찾을 수 없|확인되지 않|정보가 (없|부족))/.test(sn))) continue;
    // 주제는 "모른다" 말이 든 마디에서만 본다("위치 정보 위주라, 후기는 판단하기 어려워요"의 위치는 아는 것)
    const head = sn.slice(0, sn.search(NEG));
    const clause = sn.slice(Math.max(head.lastIndexOf(','), head.lastIndexOf('다만')) + 1);
    const ts = TOPICS.filter(([, re]) => re.test(clause)).map(([t]) => t);
    marks.push(sn);
    for (const topic of ts.length ? ts : ['병원 평가']) if (!gaps.some((g) => g.topic === topic)) gaps.push({ topic, say: sn.slice(0, 140) });
  }
  const core = coreOf(ours.name), full = keyOf(ours.name);
  const others = extractClinics(text).filter((c) => !(c.key === full || (core.length >= 2 && coreOf(c.name) === core))).map((c) => c.name).slice(0, 3);
  const unknown = /(병원|의원|곳)[^.]{0,20}(을|를)? ?(찾을 수 없|찾지 못|확인되지 않)/.test(text) && !text.includes(core)
    || sentences.some((sn) => /(찾지 못|찾을 수 없|확인되지 않)/.test(sn) && /(이라는 이름|이름으로|상호)/.test(sn));
  const sources = a.sources.map((s) => ({ ...s, title: String(s.title || '').replace(/\s+/g, ' ').trim(), kind: sourceKind(s.url, ours.host) }));
  return { text, marks: marks.slice(0, 4), gaps: gaps.slice(0, 4), others, unknown, sources, homeCited: sources.some((s) => s.kind === '우리 홈페이지') };
}

// ---------- B. 가장 많이 나온 병원과 나란히 ----------
// "그 병원 글" = 답에 붙은 출처 중 제목이나 주소에 그 병원 이름이 들어간 것(우리 병원은 우리 홈페이지도). 출처 원문을 다 읽지는 않는다.
function citedOf(asked, name, host) {
  const core = coreOf(name); const kinds = new Map(); let n = 0;
  for (const r of asked) for (const s of r.sources || []) {
    const ownHome = host && sourceKind(s.url, host) === '우리 홈페이지';
    if (!(ownHome || (core.length >= 2 && (s.title || '').replace(/\s+/g, '').includes(core)))) continue;
    n++; const k = ownHome ? '홈페이지' : (s.kind === '병원 홈페이지' ? '홈페이지' : s.kind); kinds.set(k, (kinds.get(k) || 0) + 1);
  }
  return { n, kinds: [...kinds.entries()].sort((x, y) => y[1] - x[1]).map(([kind, c]) => ({ kind, n: c })) };
}
function compareTop(asked, ours, hits, rivals, dept) {
  const big = (n) => /병원$/.test(n) && !(dept && n.includes(dept)) || /대학|의료원/.test(n);
  const top = rivals.find((r) => !big(r.name)) || rivals[0];
  if (!top) return null;
  return {
    clinicOnly: top !== rivals[0], // 대학병원 같은 큰 병원을 건너뛰었는지
    oursTop: hits >= top.n, // 우리가 제일 많이 나왔으면 상대는 "우리 다음으로 많이 나온 곳"
    ours: { hits, cited: citedOf(asked, ours.name, ours.host) },
    rival: { name: top.name, hits: top.n, cited: citedOf(asked, top.name, null) },
  };
}

module.exports = { runProbe, deptOf, regionsOf, cityOf, buildQuestions, extractClinics, keyOf, coreOf, judge, sourceKind, cleanRegion, canonHost, readIntro, compareTop, EST_KRW, RESERVE_KRW, QA_TTL_MS };
