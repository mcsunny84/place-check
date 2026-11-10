# 플레이스 체크 (place-check)

네이버 플레이스 URL을 붙여넣으면 공개 페이지를 읽어 **완성도 점수(100점)·이번 주 할 일·대표키워드 진단과 추천·Q&A식 상세설명 초안**을 보여주는 무료 웹 도구. 식당·카페 사장님용.

- 외부 패키지 0, Node 22+. 서버 1개 파일 + 순수 함수 라이브러리.
- 원문 저장 없음. 파싱된 사실(facts)만 매장별 24시간 캐시(`data/cache/`).
- 순위·매출을 예측하거나 보장하지 않는다. 점수는 "채움 정도".

## 실행

```bash
node server.js            # http://localhost:8090
PORT=80 node server.js    # 포트 변경
npm install               # @anthropic-ai/sdk (리뷰 요약용, 선택)
node --test               # 테스트 (111개, 네트워크 0)
```

## 배포 (클라우드 VM, Ubuntu 기준)

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm git   # 또는 nodesource로 Node 22
git clone <repo> place-check && cd place-check && npm install
cp .env.example .env && nano .env   # ANTHROPIC_API_KEY 입력
# 1) 먼저 이 IP에서 네이버가 열리는지 확인 (핵심)
node -e "fetch('https://pcmap.place.naver.com/restaurant/2086785604/home',{headers:{'user-agent':'Mozilla/5.0'}}).then(r=>r.text()).then(t=>console.log(t.includes('__APOLLO_STATE__')?'OK':'BLOCKED '+t.length))"
# 2) 상시 실행
sudo tee /etc/systemd/system/place-check.service >/dev/null <<'EOF'
[Unit]
Description=place-check
After=network.target
[Service]
WorkingDirectory=/home/ubuntu/place-check
Environment=PORT=80
ExecStart=/usr/bin/node server.js
Restart=always
User=root
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now place-check
```

HTTPS가 필요하면 Caddy 한 줄(`caddy reverse-proxy --from 도메인 --to :8090`)로 앞에 세운다.

## 구조

```
server.js                 큐(동시 1·1.5초 간격)·캐시(24h)·IP 제한(새 수집 3회/분)·쿨다운(429/캡차 30분)·폴백
lib/url-parse.js          URL → placeId (지원/미지원 목록)
lib/place-parse.js        pcmap HTML의 __APOLLO_STATE__ → facts (missing/empty/value 3상태)
lib/facts-to-answers.js   facts → 18문항 답 + 자동 판정
lib/place-scoring.js      채점(순수 함수, 브라우저 공용) · 할 일 · 보충 질문 · 주의 표현 사전
lib/keyword.js            대표키워드 진단·추천, 주소/역/업종/메뉴 정규화
lib/draft.js              Q&A식 상세설명 템플릿 (조사 자동)
lib/copy.js               항목별 고정 문안 (why/how)
lib/review-insight.js     리뷰 인사이트 — 장점 5·보완 5 (규칙 + 선택적 LLM)
lib/keyword-llm.js        대표키워드 AI 추천(리뷰·블로그·방문 태그 근거)
lib/draft-analysis.js     상세설명 진단 → 유지/고칠/추가 Q&A 제안
lib/naver-searchad.js     검색광고 키워드도구 API(월 검색수)
public/index.html         화면 1장 (자동 진단 / 직접 체크 / 안내)
test/                     111 테스트 + 실측 픽스처(우리 매장 3곳)
docs/                     기획·코덱스 교차검증 기록 (02→06 수렴본, 07 스파이크, 08 계약)
```

## 쿠폰 백데이터

검사된 매장마다 쿠폰 현황(제목·조건 종류·알림받기 여부, 개인정보 없음)을 `data/stats/coupons.jsonl`에 한 줄씩 남긴다. 집계는 `npm run stats`(로컬 `.env`의 `ADMIN_TOKEN`으로 운영 서버 `/api/stats/coupons` 조회).

## 사용자 답변 저장

직접 체크·보충 질문 답변을 `data/stats/answers.jsonl`에 한 줄씩 남긴다. 허용 항목·값만 저장하고(자유 입력 불가), IP는 남기지 않으며, D3 원문은 브라우저에서 판정값(`clean`/`flagged`)으로만 보낸다. 조회는 `admin.html`의 최근 답변 표 또는 `/api/stats/answers?token=ADMIN_TOKEN`.

## 손님 카드 (/persona)

플레이스 주소를 넣으면 방문자 리뷰(최근 180일, 본문 10자 이상, 최신 60건)로 자주 오는 손님 유형을 카드 최대 3장으로 보여 준다. 외식업(식당·카페·술집)만 받는다.

```
lib/persona.js            리뷰 선별 · 업종 판정 · AI 응답 검증 · 프롬프트 · 공개 응답 가공
lib/persona-store.js      결과 7일 보관 · 사건 기록 · 하루 유료 분석 상한 · 잠금 코드 확인
public/persona.html       화면 1장 (입력 → 대기 → 카드 → 코드로 열기 → 이미지 저장)
public/persona/img/       손님 그림 22종 (scripts/persona-gen-pictures.js 로 다시 만든다)
scripts/persona-dev.js    네이버·AI 없이 가짜 매장으로 화면을 보는 개발 서버 (8091, 코드 1234)
```

- **AI는 묶기만 제안한다.** 건수·막대·인용·불만 건수는 서버가 리뷰 원문과 대조해 다시 센다. 원문에 없는 인용, 단서가 없는 일행·성별·나이 근거, 아쉬움이 드러나지 않는 불만 근거는 버린다. 비중(%)은 쓰지 않고 건수만 쓴다. 나이·성별은 항상 "추정"이며 근거 2건 미만이면 중립 그림.
- **잠금**: 첫 카드는 누구나, 나머지 카드와 추가 분석은 `PERSONA_CODES`(쉼표로 여러 개, 4자리 권장)의 코드를 넣어야 응답에 실린다. 코드 확인 전 응답에는 잠긴 내용이 들어 있지 않다.
- **환경변수**: `PERSONA_CODES`(비우면 아무 코드도 통과 못 함) · `PERSONA_DAILY_MAX`(하루 유료 분석 상한, 기본 300) · `PERSONA_MODEL`(기본은 `REVIEW_MODEL`과 같음). `ANTHROPIC_API_KEY`가 없으면 분석은 `failed`.
- **비용 보호**: 매장당 AI 2회(카드 → 추가 분석), 결과 7일 보관(재조회는 무료), 같은 매장 동시 요청은 1회로 합류, AI 동시 2건·대기 20건, 새 분석은 IP당 분당 6회, 실패한 매장은 60초 쉬기, 하루 상한은 호출 전에 차감하고 돌려주지 않는다. 장부(`data/persona/daily.json`)가 깨지면 0부터 다시 세지 않고 새 분석을 닫는다(관리 화면에 경고).
- **기록**: `data/persona/events.jsonl`에 매장·업종·카드 이름·유입 채널(`?ch=ig|th|chat`)·브라우저 임의 번호만 남긴다. IP·연락처는 남기지 않는다. 조회는 `admin.html`의 「손님 카드」 또는 `/api/stats/persona?token=ADMIN_TOKEN`.
- **한계**
  - 코드는 약한 잠금이다. 채팅방 공지에 적는 4자리라 누구든 전달할 수 있고, 틀린 코드 제한(IP당 분당 10회)은 IP를 바꾸면 피할 수 있다. 전 사용자를 막는 전역 잠금은 일부러 두지 않았다(한 사람이 모두를 막을 수 있어서). 코드는 주기적으로 바꾼다.
  - IP는 소켓 주소를 쓰고, 같은 기계의 프록시(loopback)를 거친 요청만 `X-Forwarded-For`를 믿는다. 앱 포트(8090)는 밖에서 직접 닿지 않게 방화벽으로 막아 둔다.
  - 전화번호·이메일·계정·주소가 든 리뷰는 인용·미리보기·신호에서 뺀다. **사람 이름은 기계로 가려내지 못한다**(리뷰에 직원 이름이 있으면 인용에 나올 수 있다).
  - 한 줄 소개·장면·좋아하는 것·문구 제안은 AI가 쓴 문장이라 기계로 사실 여부를 보증하지 못한다. 화면에 "리뷰 내용으로 짐작한 것"이라고 밝힌다.
  - 수집이 중간에 끊겨 5건 미만이면 "리뷰 부족"으로 굳히지 않고 다시 시도하게 한다.

## 운영 한계

- 처리량 상한 약 800매장/시(매장당 fetch 3회 × 1.5초). 폭주 시 대기 90초 넘는 요청은 "직접 체크" 폴백.
- 방문자 리뷰는 최근 20건만 읽는다(더 과거는 별도 GraphQL 필요). 리뷰 인사이트의 문장 요약(장점 5·보완 5)은 `.env`의 `ANTHROPIC_API_KEY`가 있으면 켜진다(모델 `REVIEW_MODEL`, 기본 claude-sonnet-5 (opus·haiku로 바꿀 수 있음), 매장당 1회 호출 후 24시간 캐시, 약 15~20초). 키가 없으면 규칙 기반 결과만 나온다.
- 월 검색수: `.env`에 네이버 검색광고 API 라이선스 3종(`NAVER_AD_API_KEY`·`NAVER_AD_SECRET`·`NAVER_AD_CUSTOMER_ID`)이 있으면 키워드마다 월 검색수(PC+모바일)를 붙이고 AI 추천을 검색량순으로 정렬한다. 없으면 검색량 없이 동작.
- 같은 가게는 24시간 캐시. 수정 후 확인은 화면의 "네이버에서 다시 읽어오기"(마지막 수집 10분 뒤부터 가능).
- 네이버가 429/캡차를 주면 30분 쉬고 시험 1건으로 복귀. 그동안은 직접 체크만 동작.
