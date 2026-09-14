'use strict';
// 대표키워드 AI 추천 — 매장 사실(주소·업종·메뉴·리뷰 언급 메뉴·블로그 제목·손님 방문 상황)을 근거로
// "사람들이 실제로 검색할 법한" 키워드 10개 + 이유. 키 없으면 null(규칙 기반만 표시).
const MODEL = process.env.REVIEW_MODEL || 'claude-sonnet-5';
const v = (o) => (o && o.status === 'value' ? o.value : null);
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['keywords', 'diagnosis'],
  properties: {
    keywords: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keyword', 'why'], properties: { keyword: { type: 'string' }, why: { type: 'string' } } } },
    diagnosis: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['keyword', 'verdict', 'why'], properties: { keyword: { type: 'string' }, verdict: { type: 'string', enum: ['keep', 'replace'] }, why: { type: 'string' } } } },
  },
};

function buildPrompt(facts, ctx) {
  const stats = v(facts.reviewStats) || {};
  const reviews = v(facts.reviews) || [];
  const situations = {};
  for (const r of reviews) for (const c of r.visitCategories || []) situations[c] = (situations[c] || 0) + 1;
  const sit = Object.entries(situations).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ');
  const menus = (v(facts.menus) || []).slice(0, 8).map((m) => m.name).join(', ');
  const rmenus = (stats.menus || []).slice(0, 8).map((m) => `${m.name} ${m.count}`).join(', ');
  const blog = (ctx.blogTitles || []).slice(0, 8).map((t) => `- ${t}`).join('\n');
  return `가게: ${v(facts.name) || ''} / 업종(네이버 분류): ${v(facts.category) || ''} / 주소: ${v(facts.roadAddress) || ''} / 가까운 역: ${ctx.station || '없음'}
메뉴: ${menus}
리뷰에서 많이 언급된 메뉴 용어: ${rmenus}
손님 방문 상황(리뷰 태그): ${sit}
이 가게를 다룬 블로그 제목:
${blog || '(없음)'}
현재 등록된 대표키워드: ${(ctx.existing || []).join(', ') || '(없음)'}

네이버 지도·검색에서 손님이 이 가게를 찾을 때 실제로 칠 법한 검색어를 대표키워드로 10개 추천해라. 규칙: "지역(사람들이 부르는 이름: 경주, 보문단지, 안국역, 종로 등)+업종/메뉴/상황" 조합, 2~4어절, 브랜드명 제외, 네이버 분류명(양식·한식)보다 손님이 쓰는 말(바베큐, 돈카츠) 우선, 블로그 제목·리뷰 표현을 근거로. 검색량은 모르니 단정하지 말고 이유는 근거(리뷰·블로그·주소)만 한 문장. 현재 키워드 각각에 대해 keep/replace와 이유도.`;
}

async function callAnthropic(prompt) {
  let Anthropic; try { Anthropic = require('@anthropic-ai/sdk'); } catch { return null; }
  const client = new (Anthropic.default || Anthropic)();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 2048,
    output_config: { ...(/haiku/.test(MODEL) ? {} : { effort: 'low' }), format: { type: 'json_schema', schema: SCHEMA } },
    system: '당신은 네이버 플레이스 대표키워드를 정하는 로컬 마케터입니다. 손님이 실제로 검색하는 말을 씁니다. 근거 없는 검색량 주장·순위 보장 금지. 한국어.',
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return null;
  try { return JSON.parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { return null; }
}

async function recommendKeywordsLLM(facts, ctx, { llm } = {}) {
  const call = llm !== undefined ? llm : (process.env.ANTHROPIC_API_KEY ? callAnthropic : null);
  if (!call) return null;
  try {
    const j = await call(buildPrompt(facts, ctx));
    if (!j || !Array.isArray(j.keywords)) return null;
    return { keywords: j.keywords.slice(0, 10), diagnosis: Array.isArray(j.diagnosis) ? j.diagnosis.slice(0, 5) : [], model: MODEL };
  } catch (e) { console.error('[keyword-llm] 실패:', e && e.status, e && (e.message || '').slice(0, 200)); return null; }
}

module.exports = { recommendKeywordsLLM, buildPrompt, SCHEMA };
