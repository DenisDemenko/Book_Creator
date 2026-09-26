<#
  docker-recover.ps1 — лікування «Starting the Docker Engine…» за драбиною.

  Хвороба (діагноз 26.09.2026): у дистрибутиві docker-desktop зламаний індекс модулів
  (modules.dep без LF), тому ядро не має iso9660, wsl-bootstrap не може змонтувати свій ISO,
  і двигун не стартує ніколи. Лікується оновленням WSL — див. -Fix.

  Рівні (за зростанням ризику):
    (без параметрів)  діагностика і план; НІЧОГО не змінює
    -Fix              зупинити стек, wsl --shutdown, за потреби wsl --update, підняти Docker
    -Deep             те саме + дампи Postgres-контейнерів у D:\backup + wsl --unregister
                      docker-desktop (знищує ЛИШЕ головний дистрибутив; диск даних
                      %LOCALAPPDATA%\Docker\wsl\disk не чіпається) + старт Docker
    -Yes              не питати підтверджень

  Приклади:
    powershell -ExecutionPolicy Bypass -File scripts\docker-recover.ps1
    powershell -ExecutionPolicy Bypass -File scripts\docker-recover.ps1 -Fix
    powershell -ExecutionPolicy Bypass -File scripts\docker-recover.ps1 -Deep -Yes

  НІКОЛИ не видаляє %LOCALAPPDATA%\Docker\wsl\disk — там дані всіх баз.
#>
[CmdletBinding()]
param(
    [switch]$Fix,
    [switch]$Deep,
    [switch]$Yes,
    [string]$DumpDir = 'D:\backup\docker',
    [int]$EngineWaitSec = 180
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$cli = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
$desktopExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
$hostLog = "$env:LOCALAPPDATA\Docker\log\host\com.docker.backend.exe.log"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Step { param([string]$Text) Write-Host ''; Write-Host ("=== " + $Text) -ForegroundColor Cyan }
function Ok { param([string]$Text) Write-Host ("  OK   " + $Text) -ForegroundColor Green }
function Warn { param([string]$Text) Write-Host ("  !    " + $Text) -ForegroundColor Yellow }
function Bad { param([string]$Text) Write-Host ("  ЗБІЙ " + $Text) -ForegroundColor Red }

function Confirm-Action {
    param([string]$Question)
    if ($Yes) { return $true }
    $answer = Read-Host ("  " + $Question + " [y/N]")
    return ($answer -eq 'y' -or $answer -eq 'Y')
}

function Invoke-Cmd {
    param([string]$File, [string[]]$Arguments, [int]$TimeoutSec = 30)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = (($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    try { $p = [System.Diagnostics.Process]::Start($psi) } catch { return @{ Text = $_.Exception.Message; Code = -1 } }
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return @{ Text = "ТАЙМАУТ $TimeoutSec с"; Code = -2 }
    }
    return @{ Text = (($o.Result + $e.Result).Trim() -replace "`0", ''); Code = $p.ExitCode }
}

function Get-Fingerprint {
    # Повертає рядків у modules.dep або $null, якщо дистрибутив не відповів.
    # Число шукаємо регуляркою: wc додає провідні пробіли, а в тексті помилки
    # теж трапляються цифри (шлях із версією ядра).
    $kernel = (Invoke-Cmd 'wsl.exe' @('-d', 'docker-desktop', '-u', 'root', '--', 'uname', '-r') 30).Text.Trim()
    if ($kernel -notmatch 'microsoft') { return $null }
    # Шлях обчислюємо заздалегідь: конкатенація просто в масиві аргументів
    # у PowerShell розсипається на окремі аргументи (і wc отримує три замість одного).
    $modulesPath = '/lib/modules/' + $kernel + '/modules.dep'
    $wc = (Invoke-Cmd 'wsl.exe' @('-d', 'docker-desktop', '-u', 'root', '--', 'wc', '-l', $modulesPath) 30).Text
    $script:LastWc = $wc.Trim()
    $m = [regex]::Match($wc, '(?m)^\s*(\d+)\s')
    if ($m.Success) { return [int]$m.Groups[1].Value }
    return $null
}

function Stop-DockerStack {
    Step 'Зупиняю Docker Desktop і WSL-машину'
    Get-Process 'Docker Desktop', 'com.docker.backend', 'com.docker.build', 'com.docker.dev-envs' -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Ok 'процеси Docker зупинено'
    $s = (Invoke-Cmd 'wsl.exe' @('--shutdown') 60)
    if ($s.Code -eq 0) { Ok 'wsl --shutdown виконано' } else { Warn ('wsl --shutdown: ' + $s.Text) }
    Start-Sleep -Seconds 3
    $svc = (Get-Service WSLService -ErrorAction SilentlyContinue).Status
    Write-Host ("  WSLService: " + $svc)
    if ($svc -eq 'StopPending') {
        Warn 'служба застрягла в StopPending — оновлення WSL не пройде'
        Write-Host '  У консолі адміністратора виконай:'
        Write-Host '    taskkill /F /IM wslservice.exe' -ForegroundColor White
        Write-Host '    taskkill /F /IM wsl.exe' -ForegroundColor White
        Write-Host '    Start-Service WSLService' -ForegroundColor White
        Write-Host '  далі повтори цей скрипт з -Fix' -ForegroundColor White
        return $false
    }
    return $true
}

function Start-DockerAndWait {
    Step 'Піднімаю Docker Desktop'
    Start-Process $desktopExe
    $lastErr = ''
    for ($i = 1; $i -le [int]($EngineWaitSec / 10); $i++) {
        Start-Sleep -Seconds 10
        if (Test-Path -LiteralPath $hostLog) {
            $tail = (Get-Content -LiteralPath $hostLog -Tail 60 -ErrorAction SilentlyContinue) -join "`n"
            if ($tail -match 'unknown filesystem type') { $lastErr = 'iso9660'; break }
        }
        if (Test-Path -LiteralPath $cli) {
            $v = Invoke-Cmd $cli @('version', '--format', '{{.Server.Version}}') 12
            if ($v.Code -eq 0 -and $v.Text) {
                Ok ('двигун піднявся: Docker ' + $v.Text.Trim() + '  (~' + ($i * 10) + ' с)')
                Invoke-Cmd $cli @('ps', '-a', '--format', '{{.Names}}  {{.Status}}') 30 | ForEach-Object { Write-Host ('    ' + $_.Text) }
                return $true
            }
        }
        Write-Host ("  [" + ($i * 10) + ' с] чекаю двигун…')
    }
    if ($lastErr -eq 'iso9660') { Bad 'bootstrap знову впав на iso9660 — індекс модулів досі зламаний' }
    else { Bad ('двигун не піднявся за ' + $EngineWaitSec + ' с') }
    return $false
}

function Backup-Databases {
    Step 'Роблю дампи баз перед небезпечним кроком'
    if (-not (Test-Path -LiteralPath $cli)) { Warn 'docker.exe не знайдено — дампи неможливі'; return $false }
    $rows = (Invoke-Cmd $cli @('ps', '--format', '{{.Names}}|{{.Image}}') 30).Text
    $made = 0
    foreach ($row in ($rows -split "`n")) {
        if ($row -notmatch 'postgres') { continue }
        $name = ($row -split '\|')[0].Trim()
        if (-not $name) { continue }
        $user = 'postgres'
        $envs = (Invoke-Cmd $cli @('inspect', $name, '--format', '{{range .Config.Env}}{{println .}}{{end}}') 30).Text
        foreach ($line in ($envs -split "`n")) { if ($line -match '^POSTGRES_USER=(.+)$') { $user = $Matches[1].Trim() } }
        if (-not (Test-Path -LiteralPath $DumpDir)) { New-Item -ItemType Directory -Force -Path $DumpDir | Out-Null }
        $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
        $inContainer = '/tmp/dumpall.sql'
        $fileArg = '--file=' + $inContainer
        $d = Invoke-Cmd $cli @('exec', $name, 'pg_dumpall', '-U', $user, $fileArg) 300
        if ($d.Code -ne 0) { Warn ($name + ': pg_dumpall не вдався — ' + $d.Text); continue }
        $target = Join-Path $DumpDir ($name + '-dumpall-' + $stamp + '.sql')
        $srcRef = $name + ':' + $inContainer
        $c = Invoke-Cmd $cli @('cp', $srcRef, $target) 300
        if ($c.Code -eq 0) { Ok ($name + ' -> ' + $target); $made++ } else { Warn ($name + ': копіювання не вдалось — ' + $c.Text) }
    }
    if ($made -eq 0) { Warn 'жодного дампа не зроблено'; return $false }
    return $true
}

# ---------------------------------------------------------------- діагностика

Step 'Діагностика'
Write-Host ("  адмінправа: " + $isAdmin)
$engineUp = $false
if (Test-Path -LiteralPath $cli) {
    $v = Invoke-Cmd $cli @('version', '--format', '{{.Server.Version}}') 15
    if ($v.Code -eq 0 -and $v.Text) { $engineUp = $true; Ok ('двигун уже відповідає: Docker ' + $v.Text.Trim()) } else { Bad 'двигун не відповідає' }
}
else { Warn 'docker.exe не знайдено' }

$fp = Get-Fingerprint
if ($script:LastWc) { Write-Host ('  wc -l modules.dep -> ' + $script:LastWc) }
if ($fp -eq $null) { Warn 'відбиток modules.dep не отримано (дистрибутив не стартує або wsl.exe висить)' }
elseif ($fp -eq 0) {
    if ($engineUp) { Warn 'відбиток modules.dep = 0: індекс модулів зламаний — зараз двигун працює, але наступний старт може не піднятись' }
    else { Bad 'ВІДБИТОК 0: індекс модулів зламаний — це причина, чому двигун не стартує' }
}
else { Ok ("відбиток modules.dep = $fp рядків (цілий)") }

if (Test-Path -LiteralPath $hostLog) {
    $hits = @(Select-String -LiteralPath $hostLog -Pattern 'unknown filesystem type' -SimpleMatch -ErrorAction SilentlyContinue)
    Write-Host ("  у лозі Docker згадок 'unknown filesystem type': " + $hits.Count)
}

if (-not ($Fix -or $Deep)) {
    Step 'План (нічого не зроблено — це лише діагностика)'
    Write-Host '  1. Якщо відбиток 0 або в лозі є iso9660-помилки: docker-recover.ps1 -Fix'
    Write-Host '  2. Якщо -Fix не допоміг: docker-recover.ps1 -Deep   (дампи + перестворення дистрибутива)'
    Write-Host '  3. Заклинена служба (StopPending) — команди taskkill з адмінської консолі (скрипт їх підкаже)'
    Write-Host '  4. Повний звіт доказів: scripts\docker-triage.ps1'
    return
}

# ---------------------------------------------------------------- рівень 1-2

if (-not (Stop-DockerStack)) { return }

if ($Fix) {
    Step 'Оновлюю WSL (лікує зламаний індекс модулів)'
    $u = Invoke-Cmd 'wsl.exe' @('--update') 900
    Write-Host ('  ' + $u.Text)
    if ($u.Code -ne 0) {
        Warn 'wsl --update не пройшов.'
        Write-Host '  Якщо причина «could not be stopped» — закликла служба:'
        Write-Host '    (адмін) taskkill /F /IM wslservice.exe ; taskkill /F /IM wsl.exe ; Start-Service WSLService'
        Write-Host '    далі знову: docker-recover.ps1 -Fix'
        $msi = Get-ChildItem $env:TEMP -Filter 'wsl.*.msi' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($msi) { Write-Host ('  MSI у кеші: ' + $msi.FullName) }
    }
    else {
        Ok 'WSL оновлено'
        $ver = Invoke-Cmd 'wsl.exe' @('--version') 30
        Write-Host ('  ' + (($ver.Text -split "`n") | Select-Object -First 1))
        $fp2 = Get-Fingerprint
        if ($fp2 -ne $null) { Write-Host ("  відбиток modules.dep після оновлення: " + $fp2) }
    }
}

if ($Deep) {
    Step 'Глибокий рівень: дампи + перестворення головного дистрибутива'
    Warn 'Буде знищено ЛИШЕ %LOCALAPPDATA%\Docker\wsl\main (0.1 ГБ). Диск даних не чіпається.'
    if (-not (Backup-Databases)) {
        if (-not (Confirm-Action 'Дампи не вдались. Продовжити все одно?')) { Warn 'зупинено на вимогу'; return }
    }
    if (-not (Confirm-Action 'Виконати wsl --unregister docker-desktop?')) { Warn 'зупинено на вимогу'; return }
    $un = Invoke-Cmd 'wsl.exe' @('--unregister', 'docker-desktop') 180
    if ($un.Code -eq 0) { Ok 'дистрибутив знято — Docker Desktop створить його наново' } else { Bad ('--unregister: ' + $un.Text) }
}

# ---------------------------------------------------------------- підйом

if (Start-DockerAndWait) {
    Step 'Готово'
    Write-Host '  Перевір бази: docker ps, далі з''єднання застосунку.'
    Write-Host '  Якщо щось не так — scripts\docker-triage.ps1 збере докази.'
}
else {
    Step 'Не вдалося'
    Write-Host '  Збери звіт: scripts\docker-triage.ps1'
    Write-Host '  Якщо це Windows-рівень (служба, драйвери) — допоможе Restart, не Shutdown.'
}
