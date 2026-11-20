'use strict';
// 외부 API(챗GPT 검색·구글 지도) 지출 상한. 태양 결정 2026-11-19: 월 30만 원까지.
// 호출 전에 최대 예상액을 예약(reserve)하고, 끝나면 실제 금액으로 정산(settle)한다. 기록은 파일에 남아 재시작해도 이어진다.
// 장부를 믿을 수 없을 때(파일이 깨졌거나 저장이 안 될 때)는 돈이 드는 호출을 막는다.
const fs = require('fs');
const path = require('path');

function create({ file, now, monthlyKrw, dailyKrw }) {
  const monthly = Number(monthlyKrw) || 300_000;
  const daily = Number(dailyKrw) || Math.ceil(monthly / 30);
  const ym = () => new Date(now() + 9 * 3600e3).toISOString().slice(0, 7); // 한국 시각 기준 월·일
  const ymd = () => new Date(now() + 9 * 3600e3).toISOString().slice(0, 10);
  let st = { month: ym(), krw: 0, days: {} };
  let broken = false;
  if (fs.existsSync(file)) {
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j.krw === 'number') { if (j.month === ym()) st = j; } else broken = true; }
    catch { broken = true; } // 깨진 장부를 0원으로 시작하면 상한을 다시 쓰게 된다
  }
  let pending = 0;
  const roll = () => { if (st.month !== ym()) st = { month: ym(), krw: 0, days: {} }; };
  const save = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(st)); fs.renameSync(tmp, file);
    } catch { broken = true; }
  };
  return {
    reserve(krw) {
      if (broken) return false;
      roll(); const day = st.days[ymd()] || 0;
      if (st.krw + pending + krw > monthly || day + pending + krw > daily) return false;
      pending += krw; return true;
    },
    settle(actual, reserved) {
      roll(); pending = Math.max(0, pending - (reserved || 0));
      const k = Math.max(0, Math.round(actual || 0)); if (!k) return;
      st.krw += k; st.days[ymd()] = (st.days[ymd()] || 0) + k;
      const keys = Object.keys(st.days).sort(); while (keys.length > 40) delete st.days[keys.shift()];
      save();
    },
    status() { roll(); return { month: st.month, krw: st.krw, today: st.days[ymd()] || 0, monthly, daily, pending, broken }; },
  };
}

module.exports = { create };
