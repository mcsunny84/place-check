/* facts-to-answers.js — 파서 Facts(Obs) → 셀프 폼 호환 raw answers + auto 판정. 06번 §1.1 우선순위·§1.2, 08번 계약. */
'use strict';
const S = require('./place-scoring');

const MISSING = { status: 'missing' };
const obs = (facts, k) => (facts && facts[k] && typeof facts[k] === 'object' && facts[k].status) ? facts[k] : MISSING;
const isVal = o => o.status === 'value';
const isEmpty = o => o.status === 'empty';
const known = o => isVal(o) || isEmpty(o); // 읽힘(값 또는 확인된 빈 값)
const val = (facts, k) => { const o = obs(facts, k); return isVal(o) ? o.value : undefined; };
const nonBlank = v => typeof v === 'string' && v.trim() !== '';
const nonEmptyArr = v => Array.isArray(v) && v.length > 0;
const emptyArr = o => isEmpty(o) || (isVal(o) && Array.isArray(o.value) && o.value.length === 0);

function factsToAnswers(facts, opts) {
  facts = facts || {};
  const asOf = opts && opts.asOf;
  const answers = {}, auto = {};
  const set = (id, raw, source) => { answers[id] = raw; auto[id] = { state: S.judge(id, raw, { asOf, answers }), source }; };
  const unk = (id, source, note) => { auto[id] = { state: 'unknown', source, note }; };

  // A1
  {
    const p = obs(facts, 'phone'), v = obs(facts, 'virtualPhone');
    if (nonBlank(p.value) && isVal(p) || nonBlank(v.value) && isVal(v)) set('A1', 'yes', 'phone|virtualPhone');
    else if (isEmpty(p) && isEmpty(v)) set('A1', 'no', 'phone|virtualPhone');
    else unk('A1', 'phone|virtualPhone', 'missing');
  }
  // A2 · A3
  {
    const hide = obs(facts, 'hideBusinessHours'), bh = obs(facts, 'businessHours');
    const hours = isVal(bh) && Array.isArray(bh.value) ? bh.value : null;
    if (!isVal(hide) || hide.value === true) unk('A2', 'hideBusinessHours', isVal(hide) ? 'hidden' : 'missing');
    else if (emptyArr(bh)) set('A2', 'no', 'businessHours');
    else if (hours) {
      const days = new Set(hours.map(h => h && h.day).filter(Boolean)).size;
      set('A2', days >= 7 ? 'all' : days >= 1 ? 'some' : 'no', 'businessHours');
    } else unk('A2', 'businessHours', 'missing');
    const hasBreak = !!hours && hours.some(h => h && nonEmptyArr(h.breaks));
    if (hasBreak) set('A3', 'yes', 'businessHours.breaks');
    else unk('A3', 'businessHours.breaks', 'empty=unknown (fail 없음)');
  }
  // A4
  if (nonBlank(val(facts, 'accessor'))) set('A4', 'yes', 'accessor');
  else unk('A4', 'accessor', 'empty=unknown (07번 미확정)');
  // B1
  {
    const d = obs(facts, 'description');
    if (isVal(d)) set('B1', S.textLen(d.value), 'description');
    else if (isEmpty(d)) set('B1', 0, 'description');
    else unk('B1', 'description', 'information 탭 미수집');
  }
  // B2
  {
    const k = obs(facts, 'keywords');
    const arr = isVal(k) ? k.value : isEmpty(k) ? [] : null;
    if (Array.isArray(arr) && arr.length <= 5 && arr.every(x => typeof x === 'string')) set('B2', arr.length, 'keywords');
    else unk('B2', 'keywords', arr ? 'type/length error' : 'missing');
  }
  // B3 · B4
  {
    const m = obs(facts, 'menus'), menus = isVal(m) && Array.isArray(m.value) ? m.value : null;
    const price = i => obs(i, 'price'), images = i => obs(i, 'images');
    if (emptyArr(m)) set('B3', 'none', 'menus');
    else if (!menus) unk('B3', 'menus', 'missing');
    else if (menus.some(i => isVal(price(i)) && price(i).value !== '' && price(i).value != null)) set('B3', 'price', 'menus.price');
    else if (menus.every(i => isEmpty(price(i)))) set('B3', 'menu_only', 'menus.price');
    else unk('B3', 'menus.price', 'price missing 섞임');

    const mi = obs(facts, 'menuImages');
    const anyMenuImg = !!menus && menus.some(i => isVal(images(i)) && Number(images(i).value) > 0);
    if (anyMenuImg || (isVal(mi) && Number(mi.value) >= 1)) set('B4', 'yes', 'menus.images|menuImages');
    else {
      const menusEmpty = emptyArr(m) || (!!menus && menus.every(i => isEmpty(images(i)) || (isVal(images(i)) && Number(images(i).value) === 0)));
      const miEmpty = isEmpty(mi) || (isVal(mi) && Number(mi.value) === 0);
      if (menusEmpty && miEmpty) set('B4', 'no', 'menus.images|menuImages');
      else unk('B4', 'menus.images|menuImages', 'missing');
    }
  }
  // B5
  {
    const t = val(facts, 'totalImages');
    if (typeof t === 'number') set('B5', t, 'totalImages'); else unk('B5', 'totalImages', 'photo 탭 미수집');
  }
  // B6 · C3 · D3 공통: feeds
  const fo = obs(facts, 'feeds');
  const feeds = isVal(fo) && Array.isArray(fo.value) ? fo.value : isEmpty(fo) ? [] : null;
  const complete = val(facts, 'feedsComplete') === true;
  {
    if (!feeds) unk('B6', 'feeds', 'feed 탭 미수집');
    else if (feeds.length === 0) { if (complete) set('B6', 'none', 'feeds'); else unk('B6', 'feeds', 'incomplete'); }
    else {
      let newest = null, nd = null;
      for (const f of feeds) {
        const d = f && S.daysAgo(f.createdAt, asOf);
        if (d !== null && d !== undefined && (nd === null || d < nd)) { nd = d; newest = f.createdAt; }
      }
      // 첫 페이지가 최신순 정렬임을 3매장 실측(07번)으로 확인 → 첫 페이지 최댓값 = 진짜 최신. hasMore 여부와 무관하게 판정.
      if (nd === null) unk('B6', 'feeds.createdAt', 'bad date');
      else set('B6', newest, 'feeds.createdAt');
    }
  }
  // B7
  {
    const h = obs(facts, 'homepages');
    if (isVal(h) && nonEmptyArr(h.value)) set('B7', 'yes', 'homepages');
    else if (emptyArr(h)) set('B7', 'no', 'homepages');
    else unk('B7', 'homepages', 'missing');
  }
  // C1
  {
    const u = val(facts, 'naverBookingUsing');
    if (u === true) set('C1', 'on', 'businessTools.naverBooking.using');
    else if (u === false) set('C1', 'off', 'businessTools.naverBooking.using');
    else if (nonBlank(val(facts, 'naverBookingUrl'))) set('C1', 'on', 'naverBookingUrl');
    else unk('C1', 'naverBookingUsing|naverBookingUrl', 'URL 부재는 비활성 확정 아님');
  }
  // C2
  {
    const sc = val(facts, 'smartCallUsing'), tt = obs(facts, 'talktalkUrl');
    if (sc === true || (isVal(tt) && nonBlank(tt.value))) set('C2', 'yes', 'smartCallUsing|talktalkUrl');
    else if (sc === false && isEmpty(tt)) set('C2', 'no', 'smartCallUsing|talktalkUrl');
    else unk('C2', 'smartCallUsing|talktalkUrl', 'missing');
  }
  // C3
  {
    const co = obs(facts, 'hasCouponCount');
    const count = isVal(co) ? Number(co.value) : isEmpty(co) ? 0 : null;
    const events = feeds ? feeds.filter(f => f && f.category === 'EVENT') : [];
    // start ≤ asOf ≤ end (daysAgo는 유효 날짜·순서 둘 다 검사)
    const active = f => S.daysAgo(f.periodStart, asOf) !== null && S.daysAgo(asOf, f.periodEnd) !== null;
    if (count >= 1) set('C3', 'yes', 'hasCouponCount');
    else if (events.some(active)) set('C3', 'yes', 'feeds.EVENT.period');
    else if (count === null) unk('C3', 'hasCouponCount', 'missing');
    else if (!feeds || !complete) unk('C3', 'feeds', feeds ? 'incomplete' : 'feed 탭 미수집');
    else if (events.some(f => !f.periodStart || !f.periodEnd)) unk('C3', 'feeds.EVENT.period', 'period missing');
    else set('C3', 'no', 'hasCouponCount|feeds.EVENT.period');
  }
  // C4
  if (nonEmptyArr(val(facts, 'conveniences')) || nonBlank(val(facts, 'parkingInfo'))) set('C4', 'yes', 'conveniences|parkingInfo');
  else unk('C4', 'conveniences|parkingInfo', 'empty=unknown (fail 없음)');
  // D1 · D2
  if (val(facts, 'visitorReviewsTotal') === 0) {
    set('D1', 'none', 'visitorReviewsTotal');
    auto.D2 = { state: 'na', source: 'visitorReviewsTotal', note: 'D1 리뷰 없음' };
  } else {
    // /review/visitor 탭(07번 추가 실측): 최근 최대 20건에서 최신 방문일·최신 답글일
    const rv = obs(facts, 'reviews');
    const list = isVal(rv) ? rv.value : null;
    const maxDate = (arr) => arr.filter(Boolean).sort().pop() || null;
    if (Array.isArray(list) && list.length) {
      const latestVisit = maxDate(list.map((r) => r.visited || r.created));
      if (latestVisit) set('D1', latestVisit, 'reviews.visited'); else unk('D1', 'reviews', '날짜 파싱 실패');
      const latestReply = maxDate(list.map((r) => r.replyCreated));
      if (latestReply) set('D2', latestReply, 'reviews.reply');
      else if (list.some((r) => r.hasReply)) unk('D2', 'reviews.reply', '답글 있으나 날짜 파싱 실패');
      else set('D2', 'none', 'reviews.reply'); // 최근 20건 전부 답글 없음 → 운영 부재로 판정
    } else {
      unk('D1', 'reviews', isVal(rv) ? '리뷰 목록 비어 있음' : '리뷰 탭 미수집 → 보충 질문');
      unk('D2', 'reviews', '리뷰 탭 미수집 → 보충 질문');
    }
  }
  // D3
  {
    const d = obs(facts, 'description');
    if (known(d) && known(fo)) {
      const text = [isVal(d) ? d.value : ''].concat((feeds || []).slice(0, 10).map(f => (f && f.desc) || '')).join('\n');
      if (text.trim()) set('D3', { text }, 'description+feeds.desc');
      else set('D3', 'clean', 'description+feeds.desc');
    } else unk('D3', 'description+feeds.desc', '검사 범위 일부 missing');
  }
  return { answers, auto };
}

module.exports = { factsToAnswers };
