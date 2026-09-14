'use strict';
// 리뷰 인사이트 — 장점 5 · 보완할 점 5.
// 1) 결정론(항상): 전체 투표 키워드 통계 + 최근 20건(별점·답글·본문)에서 산출.
// 2) LLM(선택): ANTHROPIC_API_KEY 있으면 최근 리뷰 본문을 읽고 5/5를 문장으로. 실패·키 없음 → 결정론 결과만.
const MODEL = process.env.REVIEW_MODEL || 'claude-opus-5';
const v = (o) => (o && o.status === 'value' ? o.value : null);

function deterministic(facts) {
  const stats = v(facts.reviewStats) || {};
  const reviews = v(facts.reviews) || [];
  const voted = (stats.votedKeywords || []).slice().sort((a, b) => b.count - a.count);
  const total = stats.votedTotal || voted.reduce((s, x) => s + x.count, 0) || 0;
  const strengths = voted.slice(0, 5).map((k) => ({ text: k.name, count: k.count, share: total ? Math.round(100 * k.count / total) : null }));

  const improvements = [];
  const withReply = reviews.filter((r) => r.hasReply).length;
  if (reviews.length && withReply < reviews.length) improvements.push({ text: `최근 리뷰 ${reviews.length}건 중 ${reviews.length - withReply}건에 답글이 없어요`, kind: 'reply' });
  const low = reviews.filter((r) => typeof r.rating === 'number' && r.rating <= 3 && r.body);
  for (const r of low.slice(0, 2)) improvements.push({ text: `별점 ${r.rating} 리뷰: "${r.body.slice(0, 60).replace(/\s+/g, ' ')}…"`, kind: 'low_rating' });
  const themes = stats.themes || [];
  const themeCount = (label) => (themes.find((t) => t.label === label) || {}).count || 0;
  const tasteN = themeCount('맛');
  for (const [label, hint] of [['서비스', '친절·응대 언급이 적어요 — 인사 한마디, 답글이 서비스 인식을 올려요'], ['분위기', '분위기 언급이 적어요 — 인테리어·좌석 사진을 늘려보세요'], ['청결도', '청결 언급이 적어요 — 화장실·테이블 정리 사진 한 장이면 신호가 생겨요']]) {
    if (tasteN && themeCount(label) < tasteN * 0.1 && improvements.length < 5) improvements.push({ text: hint, kind: 'theme_low' });
  }
  const negWords = ['웨이팅', '대기', '늦', '느리', '불친절', '비싸', '아쉬'];
  const negHits = reviews.filter((r) => r.body && negWords.some((w) => r.body.includes(w)));
  if (negHits.length && improvements.length < 5) improvements.push({ text: `최근 리뷰 ${negHits.length}건에 대기·가격·응대 관련 아쉬움 표현이 있어요`, kind: 'neg_words' });
  return { strengths, improvements: improvements.slice(0, 5), stats: { totalCount: stats.totalCount, avgRating: stats.avgRating, recent: reviews.length, recentWithReply: withReply, themes: themes.slice(0, 6) } };
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['strengths', 'improvements'],
  properties: {
    strengths: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
    improvements: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' } },
  },
};

async function callAnthropic(prompt) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); } catch { return null; }
  const client = new Anthropic.default ? new Anthropic.default() : new Anthropic();
  const res = await client.messages.create({
    model: MODEL, max_tokens: 2048,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: '당신은 식당·카페 사장님을 돕는 리뷰 분석가입니다. 주어진 최근 방문자 리뷰와 키워드 통계만 근거로, 손님이 실제로 칭찬한 장점과 사장님이 고칠 수 있는 보완점을 각각 한 문장씩 한국어로 씁니다. 근거 없는 추측·과장·순위나 매출 약속 금지. 보완점은 사장님이 행동할 수 있는 것으로.',
    messages: [{ role: 'user', content: prompt }],
  });
  if (res.stop_reason === 'refusal') return null;
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch { return null; }
}

function buildPrompt(facts, det) {
  const reviews = (v(facts.reviews) || []).filter((r) => r.body).slice(0, 20);
  const lines = reviews.map((r, i) => `${i + 1}. [별점 ${r.rating ?? '-'} · ${r.visited || ''}] ${r.body.replace(/\s+/g, ' ').slice(0, 400)}${r.votedKeywords.length ? ` (투표: ${r.votedKeywords.join(', ')})` : ''}`);
  const kw = (det.strengths || []).map((s) => `${s.text} ${s.count}`).join(', ');
  return `가게: ${v(facts.name) || ''} (${v(facts.category) || ''})\n전체 리뷰 ${det.stats.totalCount ?? '?'}건, 평균 ${det.stats.avgRating ?? '?'}점. 전체 투표 키워드 상위: ${kw}\n\n최근 리뷰 ${lines.length}건:\n${lines.join('\n')}\n\n장점 5개, 보완할 점 5개를 JSON으로.`;
}

async function buildInsight(facts, { llm } = {}) {
  if (!v(facts.reviews) && !v(facts.reviewStats)) return null;
  const det = deterministic(facts);
  const out = { source: 'rules', ...det };
  const hasBodies = (v(facts.reviews) || []).some((r) => r.body);
  const call = llm !== undefined ? llm : (process.env.ANTHROPIC_API_KEY ? callAnthropic : null);
  if (call && hasBodies) {
    try {
      const j = await call(buildPrompt(facts, det));
      if (j && Array.isArray(j.strengths) && Array.isArray(j.improvements)) {
        out.source = 'llm';
        out.llm = { strengths: j.strengths.slice(0, 5), improvements: j.improvements.slice(0, 5), model: MODEL };
      }
    } catch { /* LLM 실패 → 결정론 결과만 */ }
  }
  return out;
}

module.exports = { buildInsight, deterministic, buildPrompt, SCHEMA, MODEL };
