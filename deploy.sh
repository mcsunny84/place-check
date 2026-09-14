#!/usr/bin/env bash
# 플레이스 체크 — Ubuntu VM 1회 설치 스크립트 (Lightsail/Vultr 서울 리전 기준)
# 사용: curl -fsSL <raw url>/deploy.sh | bash   또는  bash deploy.sh
set -euo pipefail
REPO="${REPO:-https://github.com/mcsunny84/place-check.git}"
DIR="$HOME/place-check"

echo "== 1) Node 22 설치"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs git
fi
node -v

echo "== 2) 네이버 접근 확인 (이 VM의 IP로 pcmap이 열리는지)"
node -e "fetch('https://pcmap.place.naver.com/restaurant/2086785604/home',{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}}).then(r=>r.text()).then(t=>{const ok=t.includes('__APOLLO_STATE__');console.log(ok?'NAVER OK':'NAVER BLOCKED (len '+t.length+')');process.exit(ok?0:2)})" || { echo '!! 이 IP에서 네이버가 막혀 있습니다. 인스턴스를 삭제하고 다른 리전/업체로 다시 만드세요.'; exit 2; }

echo "== 3) 코드 받기"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR" && npm install --omit=dev --no-audit --no-fund

echo "== 4) .env"
if [ ! -f .env ]; then cp .env.example .env; echo '>> .env를 열어 키를 채우세요: nano ~/place-check/.env  (ANTHROPIC_API_KEY, NAVER_AD_*)'; fi

echo "== 5) systemd 등록 (포트 80)"
sudo tee /etc/systemd/system/place-check.service >/dev/null <<EOF
[Unit]
Description=place-check
After=network.target
[Service]
WorkingDirectory=$DIR
Environment=PORT=80
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
User=root
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now place-check
sleep 2
sudo systemctl --no-pager --lines=5 status place-check || true
echo "== 완료. 브라우저에서 http://$(curl -s ifconfig.me 2>/dev/null || echo '<VM 공인 IP>') 접속"
echo "   키 넣은 뒤 재시작: sudo systemctl restart place-check   / 로그: sudo journalctl -u place-check -f"
