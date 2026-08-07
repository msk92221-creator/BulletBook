@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install the Node.js LTS version, and then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

if not exist "%~dp0windows-host.mjs" (
  echo [ERROR] windows-host.mjs was not found.
  echo Extract the complete BulletBook ZIP file and run this file again.
  pause
  exit /b 1
)

start "BulletBook Sync" /min node "%~dp0windows-host.mjs"
endlocal
