@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 금융 자료 수집 · 정리

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist "package-lock.json" (
  echo 처음 실행이라 npm install 을 실행합니다...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo [오류] npm install 에 실패했습니다.
    pause
    exit /b 1
  )
)

start "" http://localhost:5198
node server.mjs
pause
