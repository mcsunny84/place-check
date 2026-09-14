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

## 운영 한계

- 처리량 상한 약 800매장/시(매장당 fetch 3회 × 1.5초). 폭주 시 대기 90초 넘는 요청은 "직접 체크" 폴백.
- 방문자 리뷰는 최근 20건만 읽는다(더 과거는 별도 GraphQL 필요). 리뷰 인사이트의 문장 요약(장점 5·보완 5)은 `.env`의 `ANTHROPIC_API_KEY`가 있으면 켜진다(모델 `REVIEW_MODEL`, 기본 claude-sonnet-5 (opus·haiku로 바꿀 수 있음), 매장당 1회 호출 후 24시간 캐시, 약 15~20초). 키가 없으면 규칙 기반 결과만 나온다.
- 월 검색수: `.env`에 네이버 검색광고 API 라이선스 3종(`NAVER_AD_API_KEY`·`NAVER_AD_SECRET`·`NAVER_AD_CUSTOMER_ID`)이 있으면 키워드마다 월 검색수(PC+모바일)를 붙이고 AI 추천을 검색량순으로 정렬한다. 없으면 검색량 없이 동작.
- 같은 가게는 24시간 캐시. 수정 후 확인은 화면의 "네이버에서 다시 읽어오기"(마지막 수집 10분 뒤부터 가능).
- 네이버가 429/캡차를 주면 30분 쉬고 시험 1건으로 복귀. 그동안은 직접 체크만 동작.
