# Design

<!-- impeccable:design-schema 1 -->

## World
한국 핀테크·커머스 제품 UI의 정석(토스 계열)을 그대로, 완성도로 승부한다. 흰 카드가 연회색 바닥 위에 떠 있고, 큰 숫자가 먼저 읽히고, 글은 숫자 옆 한 줄. 장식 없음, 테두리 없음, 상태는 색+글자. 사장님이 폰으로 한 손에 읽는다 — 밝은 가게 조명 아래, 라이트 모드 고정.

## Color (Restrained)
- ground `--bg #f2f4f6` / surface `--card #ffffff` / sunken `--well #f9fafb`
- ink `--ink #191f28` / secondary `--muted #4e5968` / faint `--faint #8b95a1` / hairline `--line #e5e8eb`
- accent(행동·선택·진행) `--accent #3b63f3`, hover `#2f52d6`, tint `--accent-bg #eef2ff`
- status: good `#0bb07b`(bg `#e7f8f1`) · warn `#e08a00`(bg `#fff4e0`) · bad `#e5484d`(bg `#fdecec`). 상태색은 항상 라벨 글자와 함께.
- 그래프 데이터색: accent 1개 + ink 0.55. 회색 = 규칙 불통과/미확인.

## Type
- Pretendard Variable (jsdelivr dynamic subset), 폴백 system-ui/Apple SD Gothic/Malgun.
- 고정 rem 스케일 1.2: 13 / 15(본문) / 17 / 20 / 24 / 32 / 44(히어로 숫자). 숫자는 800, 제목 700, 본문 500.
- 자간: 제목 -0.02em, 히어로 숫자 -0.03em. 본문 줄간 1.6, 숫자 1.1.

## Shape & space
- 카드 radius 20px, 작은 요소 12px, 버튼 14px. 그림자: `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(25,31,40,.06)`.
- 간격 8 단위: 카드 패딩 24(폰 20), 섹션 사이 32, 제목 위 24 아래 12.
- 막대 12px, 데이터 끝 둥글게. 게이지 선 10px.

## Components
- 주 버튼: accent 채움, 흰 글자, 52px 높이, 전체폭(폰). 보조: well 바닥, ink 글자. 비활성: 40% 투명.
- 입력: well 바닥, 테두리 없음, 포커스 시 accent 2px 링. 라벨 13px muted 위.
- 상태 칩: 둥근 12px, 상태 bg + 상태 글자, 글자 700.
- 접힘: `<details>` 네이티브, summary = 제목 + 우측 "자세히" + 화살표 회전.
- 섹션 제목: 20px 700, 번호·영문 꼬리표 없음.

## Motion
- 150–200ms ease-out, 상태 변화에만. 막대는 처음 그려질 때 1회 width 전환. 페이지 로드 연출 없음.

## Copy
- 사장님께 존댓말, 짧게. "~해요". 숫자 먼저, 이유 한 줄, 행동 한 줄. 과장·보장 문구 금지.
