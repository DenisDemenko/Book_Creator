@echo off
rem Реєстрація посилання designcraft-studio:// (лише для поточного користувача Windows).
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-designcraft-link.ps1" %*
pause
