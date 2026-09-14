# 플레이스 체크 (place-check)

네이버 플레이스 URL을 붙여넣으면 공개 페이지를 읽어 **완성도 점수(100점)·이번 주 할 일·대표키워드 진단과 추천·Q&A식 상세설명 초안**을 보여주는 무료 웹 도구. 식당·카페 사장님용.

- 외부 패키지 0, Node 22+. 서버 1개 파일 + 순수 함수 라이브러리.
- 원문 저장 없음. 파싱된 사실(facts)만 매장별 24시간 캐시(`data/cache/`).
- 순위·매출을 예측하거나 보장하지 않는다. 점수는 "채움 정도".

## 실행

```bash
node server.js            # http://localhost:8090
PORT=80 node server.js    # 포트 변경
node --test               # 테스트 (91개, 네트워크 0)
```

## 배포 (클라우드 VM, Ubuntu 기준)

```bash
sudo apt-get update && sudo apt-get install -y nodejs npm git   # 또는 nodesource로 Node 22
git clone <repo> place-check && cd place-check
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
public/index.html         화면 1장 (자동 진단 / 직접 체크 / 안내)
test/                     84 테스트 + 실측 픽스처(우리 매장 3곳)
docs/                     기획·코덱스 교차검증 기록 (02→06 수렴본, 07 스파이크, 08 계약)
```

## 운영 한계

- 처리량 상한 약 480매장/시(매장당 fetch 5회 × 1.5초). 폭주 시 대기 90초 넘는 요청은 "직접 체크" 폴백.
- 방문자 리뷰는 최근 20건만 읽는다(더 과거는 별도 GraphQL 필요). 리뷰 인사이트의 문장 요약은 `ANTHROPIC_API_KEY`를 주면 켜지고(모델 `REVIEW_MODEL`, 기본 claude-opus-5, `npm i @anthropic-ai/sdk` 필요), 없으면 규칙 기반 결과만 나온다.
- 네이버가 429/캡차를 주면 30분 쉬고 시험 1건으로 복귀. 그동안은 직접 체크만 동작.
