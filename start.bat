@echo off
rem HEAVY STEEL starten (Windows): lokaler Webserver + Browser. Braucht keine Installation.
title HEAVY STEEL
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\serve.ps1"
if errorlevel 1 pause
