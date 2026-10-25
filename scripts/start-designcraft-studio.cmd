@echo off
rem Запуск DesignCraft зі Студією без зміни політики виконання PowerShell.
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-designcraft-studio.ps1" %*
echo.
echo Код завершення: %ERRORLEVEL%. Журнал: designcraft-work\last-run.log
pause
