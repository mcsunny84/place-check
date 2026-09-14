# NEO Claude Code ↔ Codex 연결

별도 CLI 검토를 실행해 파일을 주고받는다. 현재 열려 있는 두 GUI 대화에 메시지를 삽입하는 방식은 아니다. 기존 로그인과 사용량을 사용하며 새 API 키가 필요하지 않다.

## 사용

프로젝트 place-check 폴더에서 실행:

```powershell
node .review-bridge/bridge.cjs check
node .review-bridge/bridge.cjs pingpong .review-bridge/request.md docs/02_기획_경량판_v0.4.md
```

`pingpong`: Claude 검토 → Codex 응답 → Claude 최종 회신 (3회 호출 후 종료).
`claude` / `codex`: 상대에게 한 번만 요청. 요청.md와 근거 문서 경로를 뒤에 전달한다.

결과는 `.review-bridge/runs/<시각-ID>/`의 01_CLAUDE.md, 02_CODEX.md, 03_CLAUDE_REPLY.md. status.json에 성공/실패와 사용한 모델 설정을 기록한다. 실패하면 완료로 보고하지 않는다. 토큰 한도/인증/모델 미지원은 로그로 확인하고 자동으로 다른 모델로 바꾸지 않는다.

Claude Code 또는 Codex에 "place-check/.review-bridge/README.md를 읽고 이 기획을 pingpong 검토해줘"라고 요청하면 된다. GUI 대화 내용은 자동 전달되지 않으므로 request.md에 새 결정을 적거나 근거 파일을 함께 전달한다.

원본 문서는 자동 덮어쓰지 않는다. 합의된 변경은 대화 담당 에이전트가 반영한다. 검토는 코드 실행용 스킬의 적대 검토 원칙을 활용하되 수정 전 기획 단계에 맞춘다. 구현·자동 게시·무한 루프·예약 실행은 이 스크립트에 포함하지 않는다.
