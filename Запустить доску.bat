@echo off
chcp 65001 >nul
title Доска
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите его с https://nodejs.org ^(версия LTS^) и запустите этот файл снова.
  echo.
  pause
  exit /b 1
)

if not exist node_modules\ws (
  echo Первая подготовка, это займёт около минуты...
  call npm install --omit=dev
  if errorlevel 1 (
    echo Не получилось установить зависимости. Проверьте интернет.
    pause
    exit /b 1
  )
)

echo Доска запускается. Не закрывайте это окно, пока идёт урок.
echo.
node server.js --open
pause
