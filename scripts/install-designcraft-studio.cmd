@echo off
rem Встановлення запуску DesignCraft для Студії без зміни політики виконання PowerShell.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-designcraft-studio.ps1" %*
echo.
pause
