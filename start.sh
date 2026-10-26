#!/bin/sh
# macOS·Linux 실행 스크립트:  sh start.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "[오류] Node.js 가 없습니다. https://nodejs.org 에서 LTS 를 설치하세요."; exit 1; }
[ -f package-lock.json ] || npm install --no-fund --no-audit || exit 1
( sleep 2; open http://localhost:5198 2>/dev/null || xdg-open http://localhost:5198 2>/dev/null ) &
node server.mjs
