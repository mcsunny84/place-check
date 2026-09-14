'use strict';
// 상세설명 진단 — "현재 글에 무엇이 있고 무엇이 빠졌나"를 먼저 보여주고, 빠진 것만 Q&A로 추가 제안한다.
// 1) 결정론(항상): 길이·Q&A 형식·주제 커버리지·지역/업종어·주의 표현.  2) LLM(선택): 현재 문장 기준 수정/추가 제안(현재→제안).
const S = require('./place-scoring');
const D = require('./draft');
const MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-5';
const v = (o) => (o && o.status === 'value' ? o.value : null);
const has = (text, re) => re.test(text);

const TOPICS = [
  { key: 'menu', label: '대표 메뉴·가격', re: /메뉴|카츠|정식|세트|\d{1,3}(,\d{3})+원|원\b/ },
  { key: 'hours', label: '영업시간·휴무', re: /영업시간|\d{1,2}:\d{2}|\d{1,2}시|휴무|브레이크|휴게/ },
  { key: 'parking', label: '주차', re: /주차/ },
  { key: 'booking', label: '예약', re: /예약/ },
  { key: 'takeout', label: '포장·배달', re: /포장|배달|테이크아웃/ },
  { key: 'road', label: '찾아오는 길', re: /출구|도보|역에서|건물|층|골목|직진|맞은편|근처/ },
  { key: 'group', label: '단체·좌석', re: /단체|회식|모임|좌석|룸|테이블|인원/ },
  { key: 'qa', label: 'Q&A 형식', re: /(^|\n)\s*Q[.:)]|질문\s*[:：]|\?\s*\n\s*A[.:)]/ },
];

function analyzeDescription(description, facts, ctx = {}) {
  const text = typeof description === 'string' ? description.normalize('NFC') : '';
  const len = Array.from(text.trim()).length;
  const district = ctx.district || null, station = ctx.station || null, cat = ctx.categoryNorm || null;
  const topics = TOPICS.map((t) => ({ key: t.key, label: t.label, covered: !!text && has(text, t.re) }));
  const regionHit = !!text && [district, station, station && station.replace(/역$/, '')].filter(Boolean).some((r) => text.includes(r));
  const catHit = !!text && !!cat && (text.includes(cat) || (ctx.reviewMenus || []).some((m) => text.includes(m)));
  const kws = ctx.existing || [];
  const kwHit = kws.filter((k) => k && text.replace(/\s+/g, '').includes(String(k).replace(/\s+/g, '')));
  const danger = text ? S.scanDanger(text) : [];

  // 빠진 주제 → facts로 채울 수 있는 Q&A만 제안
  const conv = v(facts.conveniences) || [];
  const menus = (v(facts.menus) || []).slice(0, 2);
  const hours = v(facts.businessHours);
  const add = [];
  const c = (k) => topics.find((t) => t.key === k).covered;
  if (!c('parking') && (v(facts.parkingInfo) || conv.includes('주차'))) add.push({ q: '주차 되나요?', a: v(facts.parkingInfo) || '주차 가능합니다.', why: '주차 문의가 잦은 항목인데 설명에 없어요. 플레이스 주차 정보에 이미 적어둔 내용을 그대로 옮기면 됩니다.' });
  if (!c('booking')) {
    if (ctx.booking === 'naver') add.push({ q: '예약 가능한가요?', a: '네이버 예약으로 바로 예약할 수 있어요.', why: '네이버 예약이 켜져 있는데 설명에는 없어요.' });
    else if (ctx.phone) add.push({ q: '예약 가능한가요?', a: `전화(${ctx.phone})로 문의해 주세요.`, why: '예약 방법이 설명에 없어요.' });
  }
  if (!c('takeout') && (conv.includes('포장') || conv.includes('배달'))) add.push({ q: '포장이나 배달 되나요?', a: `${conv.includes('포장') ? '포장 가능합니다. ' : ''}${conv.includes('배달') ? '배달도 가능합니다.' : '배달은 하지 않습니다.'}`.trim(), why: '편의시설에 포장/배달이 등록돼 있는데 설명에는 없어요.' });
  if (!c('road') && v(facts.road)) add.push({ q: station ? `${D.particle ? station : station}에서 어떻게 가요?` : '어떻게 찾아가요?', a: v(facts.road), why: '찾아오는 길 안내가 따로 등록돼 있어요. 설명에도 한 줄 넣으면 AI 검색이 함께 읽어요.' });
  if (!c('group') && conv.includes('단체 이용 가능')) add.push({ q: '단체도 되나요?', a: '단체 이용 가능합니다. 인원이 많으면 미리 연락 주세요.', why: '단체 이용 가능으로 등록돼 있는데 설명에는 없어요.' });
  if (!c('hours') && hours && hours.length) add.push({ q: '영업시간은요?', a: `${hours[0].day}~${hours[hours.length - 1].day} ${hours[0].start}~${hours[0].end}${hours[0].breaks && hours[0].breaks.length ? ` (휴게 ${hours[0].breaks[0].start}~${hours[0].breaks[0].end})` : ''}`, why: '영업시간이 설명에 없어요. 시간 바뀌면 여기도 같이 고쳐야 하니 짧게만.' });
  if (!c('menu') && menus.length) add.push({ q: `${district || station || ''}에서 ${cat || '여기'} 뭐가 맛있어요?`.trim(), a: `대표 메뉴는 ${menus.map((m) => m.name + (m.price && m.price.status === 'value' ? `(${Number(m.price.value).toLocaleString('ko-KR')}원)` : '')).join(', ')}입니다.`, why: '대표 메뉴와 가격이 설명에 없어요.' });

  const edits = [];
  if (text && !regionHit && (district || station)) edits.push({ what: `첫 문장에 "${station ? station + ' 인근' : district}" 같은 지역명을 넣으세요.`, why: '지역+업종으로 검색될 때 설명에 지역명이 있어야 연결돼요.' });
  if (text && !catHit && cat) edits.push({ what: `"${cat}" 같은 업종·메뉴 단어를 첫 문장에 넣으세요.`, why: '손님이 검색하는 말(업종·메뉴)이 설명에 없어요.' });
  if (text && kws.length && kwHit.length < Math.min(2, kws.length)) edits.push({ what: `대표키워드 중 설명에 들어간 게 ${kwHit.length}개예요. 2~3개는 자연스럽게 녹이세요.`, why: '대표키워드와 설명이 같은 말을 써야 신호가 겹쳐요.' });
  if (text && !c('qa')) edits.push({ what: '핵심 정보 3~5개를 "Q. … / A. …" 묶음으로 바꾸거나 뒤에 덧붙이세요.', why: 'AI 검색이 질문-답 구조를 통째로 인용하기 쉬워요.' });
  if (!text) edits.push({ what: '상세설명이 비어 있어요. 아래 제안 Q&A를 그대로 붙여넣는 것부터 시작하세요.', why: '빈 설명은 AI·검색 모두에 줄 정보가 없어요.' });
  for (const dgr of danger) edits.push({ what: `"${dgr.match}" 표현은 빼세요.`, why: `${dgr.label} — 리뷰 정책 위반 소지.` });

  return { length: len, hasText: !!text, topics, regionHit, catHit, keywordsInText: kwHit, danger, add, edits };
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['assessment', 'keep', 'changes', 'add'],
  properties: {
    assessment: { type: 'string' },
    keep: { type: 'array', items: { type: 'string' } },
    changes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['current', 'proposed', 'why'], properties: { current: { type: 'string' }, proposed: { type: 'string' }, why: { type: 'string' } } } },
    add: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['q', 'a', 'why'], properties: { q: { type: 'string' }, a: { type: 'string' }, why: { type: 'string' } } } },
  },
};

function buildPrompt(description, facts, ctx, analysis) {
  const stats = v(facts.reviewStats) || {};
  const kw = (stats.votedKeywords || []).slice(0, 5).map((k) => `${k.name} ${k.count}`).join(', ');
  const missing = analysis.topics.filter((t) => !t.covered).map((t) => t.label).join(', ');
  return `가게: ${v(facts.name) || ''} / 업종: ${v(facts.category) || ''} / 지역: ${ctx.district || ''} ${ctx.station || ''}
대표키워드: ${(ctx.existing || []).join(', ') || '(없음)'}
손님 리뷰 투표 키워드 상위: ${kw}
주차: ${v(facts.parkingInfo) || (v(facts.conveniences) || []).includes('주차') ? '가능' : '정보 없음'} / 예약: ${ctx.booking || '없음'} / 편의: ${(v(facts.conveniences) || []).join(', ')}
찾아오는 길(등록됨): ${v(facts.road) || '(없음)'}

[현재 상세설명 — 원문]
${description || '(비어 있음)'}

규칙 검사 결과: 글자 수 ${analysis.length}, Q&A 형식 ${analysis.topics.find((t) => t.key === 'qa').covered ? '있음' : '없음'}, 빠진 주제: ${missing || '없음'}.

해야 할 일: (1) 현재 글을 2문장으로 평가(잘한 점·아쉬운 점). (2) 그대로 둘 문장 keep. (3) 고칠 문장은 changes에 current(원문 그대로 인용)→proposed(고친 문장)와 why. (4) 추가할 내용은 add에 Q&A(질문·답·이유). 원문에 없는 사실은 위 데이터에 있는 것만 쓰고, 없는 사실은 지어내지 말 것. 순위·효능·최고 같은 과장 금지. 사장님이 복사해 붙일 수 있게 답은 2~3문장.`;
}

async function callAnthropic(prompt) {
  let Anthropic; try { Anthropic = require('@anthropic-ai/sdk'); } catch { return null; }
  const client = new (Anthropic.default || Anthropic)();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 3000,
    output_config: { ...(/haiku/.test(MODEL) ? {} : { effort: 'low' }), format: { type: 'json_schema', schema: SCHEMA } },
    system: '당신은 네이버 플레이스 상세설명을 다듬는 편집자입니다. 사장님 글의 원문을 존중하고, 근거 있는 사실만 보태며, 질문-답 형식으로 정리합니다. 한국어.',
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return null;
  try { return JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { return null; }
}

async function reviseDescriptionLLM(description, facts, ctx, analysis, { llm } = {}) {
  const call = llm !== undefined ? llm : (process.env.ANTHROPIC_API_KEY ? callAnthropic : null);
  if (!call) return null;
  try {
    const j = await call(buildPrompt(description, facts, ctx, analysis));
    if (!j || typeof j.assessment !== 'string') return null;
    return { assessment: j.assessment, keep: (j.keep || []).slice(0, 5), changes: (j.changes || []).slice(0, 6), add: (j.add || []).slice(0, 6), model: MODEL };
  } catch (e) { console.error('[draft-analysis] LLM 실패:', e && e.status, e && (e.message || '').slice(0, 200)); return null; }
}

module.exports = { analyzeDescription, reviseDescriptionLLM, buildPrompt, TOPICS, SCHEMA };
