# Запуск локального сервера приватного сховища (Windows PowerShell).
# 1) перевіряє Docker, 2) створює .env і головний ключ, якщо їх ще немає, 3) збирає й запускає контейнер, 4) показує стан.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Error 'Docker не знайдено. Встановіть Docker Desktop (https://www.docker.com/products/docker-desktop) і запустіть його.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Error 'Docker не запущено. Запустіть Docker Desktop і повторіть.' }

if (-not (Test-Path (Join-Path $root '.env'))) {
    Copy-Item (Join-Path $root '.env.example') (Join-Path $root '.env')
    Write-Host 'Створено файл .env. Відкрийте його, вкажіть STUDIO_URL і PAIRING_CODE (код видає адмінпанель Studio після підтвердження поштою), потім запустіть скрипт знову.'
    exit 0
}

& (Join-Path $PSScriptRoot 'init-secrets.ps1')

& docker compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Error 'docker compose не зміг запустити сервер.' }

Write-Host ''
Write-Host 'Чекаю, поки сервер відповість...'
$port = 8787
$line = Select-String -Path (Join-Path $root '.env') -Pattern '^PRIVATE_STORE_PORT=(\d+)' | Select-Object -First 1
if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
for ($i = 0; $i -lt 30; $i++) {
    try {
        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$port/v1/health" -TimeoutSec 3
        Write-Host "Сервер працює: версія $($h.version), підключення до Studio: $($h.status)."
        if (-not $h.paired) { Write-Host 'Сервер ще не підключено до Studio: вкажіть PAIRING_CODE у .env і виконайте docker compose up -d.' }
        break
    } catch { Start-Sleep -Seconds 1 }
}
& docker compose logs --tail 15
