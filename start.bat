@echo off
rem VIBE SAMURAI starten (Windows): lokaler Webserver + Browser. Braucht keine Installation.
title VIBE SAMURAI
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 pause
