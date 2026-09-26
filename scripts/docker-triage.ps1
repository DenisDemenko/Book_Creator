<#
  docker-triage.ps1 — діагностика «Docker Desktop не піднімає двигун» на цій машині.

  Збирає докази в один файл, щоб наступного разу не розслідувати з нуля:
    • версії WSL, ядра, Docker Desktop;
    • ВІДБИТОК ХВОРОБИ: wc -l modules.dep у дистрибутиві docker-desktop
      (0 рядків при ~76 КБ = зламаний індекс модулів, через нього немає iso9660,
       через iso9660 падає wsl-bootstrap і двигун не стартує);
    • чи є iso9660 у /proc/filesystems;
    • скільки разів у лозі Docker була помилка unknown filesystem type;
    • стан WSLService (StopPending = заклик), vmmem, кількість процесів msrdc;
    • події Kernel-EventTracing ID 2 за добу;
    • місце на дисках і розміри vhdx.

  Використання:
    powershell -ExecutionPolicy Bypass -File scripts\docker-triage.ps1
    powershell -ExecutionPolicy Bypass -File scripts\docker-triage.ps1 -NoWsl

  -NoWsl — не викликати wsl.exe (якщо він висить і блокую терминал).
  Скрипт НІЧОГО не змінює. Звіт: tmp\docker-triage-<дата-час>.txt
#>
[CmdletBinding()]
param(
    [switch]$NoWsl,
    [string]$OutDir
)

# $PSScriptRoot порожній у блоці param, якщо скрипт запускають через
# «powershell -File …» — тому каталог визначаємо вже в тілі скрипта.
if (-not $OutDir) {
    $scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $OutDir = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..\tmp'))
}

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$report = New-Object System.Collections.Generic.List[string]
function Add-Line {
    param([string]$Text = '')
    $report.Add($Text)
    Write-Host $Text
}

# Запуск зовнішньої команди з таймаутом: wsl.exe на заклиненій службі висить назавжди.
# -Utf16 потрібен там, де wsl.exe пише UTF-16LE (наприклад «wsl --version»), інакше
# кирилиця перетворюється на сміття.
function Invoke-Cmd {
    param([string]$File, [string[]]$Arguments, [int]$TimeoutSec = 25, [switch]$Utf16)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $File
    $psi.Arguments = (($Arguments | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    if ($Utf16) {
        $psi.StandardOutputEncoding = [System.Text.Encoding]::Unicode
        $psi.StandardErrorEncoding = [System.Text.Encoding]::Unicode
    }
    try { $p = [System.Diagnostics.Process]::Start($psi) } catch { return 'НЕ ЗАПУСТИЛОСЬ: ' + $_.Exception.Message }
    $o = $p.StandardOutput.ReadToEndAsync()
    $e = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit($TimeoutSec * 1000)) {
        try { $p.Kill() } catch { }
        return "ТАЙМАУТ $TimeoutSec с (процес убито) — сама це ознака заклиненої служби"
    }
    $text = ($o.Result + $e.Result).Trim() -replace "`0", ''
    if ([string]::IsNullOrWhiteSpace($text)) { $text = '(порожньо)' }
    return $text
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$reportPath = Join-Path $OutDir ("docker-triage-" + $stamp + '.txt')

Add-Line ("Звіт docker-triage — " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Add-Line ("Машина: " + $env:COMPUTERNAME + ", користувач: " + $env:USERNAME)
Add-Line ''

Add-Line '--- Windows ---'
$os = Get-CimInstance Win32_OperatingSystem
Add-Line ("  " + $os.Caption + " " + $os.Version + " build " + $os.BuildNumber)
Add-Line ("  Fast Startup (HiberbootEnabled): " + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power' -Name HiberbootEnabled -ErrorAction SilentlyContinue).HiberbootEnabled)
Add-Line ("  RAM total GB: " + [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1))
Add-Line ''

Add-Line '--- Docker Desktop ---'
$dd = Get-ChildItem "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe" -ErrorAction SilentlyContinue
if ($dd) { Add-Line ("  версія: " + $dd.VersionInfo.FileVersion) } else { Add-Line '  не знайдено у %LOCALAPPDATA%\Programs\DockerDesktop' }
$dockerProcs = @(Get-Process 'Docker Desktop', 'com.docker.backend', 'com.docker.build' -ErrorAction SilentlyContinue)
Add-Line ("  процесів: " + $dockerProcs.Count)
Add-Line ''

Add-Line '--- Служби та процеси-супутники ---'
Add-Line ("  WSLService: " + (Get-Service WSLService -ErrorAction SilentlyContinue).Status)
Add-Line ("  vmmem живий: " + [bool](Get-Process vmmem -ErrorAction SilentlyContinue))
$msrdc = @(Get-Process msrdc -ErrorAction SilentlyContinue)
Add-Line ("  msrdc (WSLg-клієнт): " + $msrdc.Count + "  (>20 = шторм, лік — guiApplications=false у .wslconfig)")
Add-Line ''

Add-Line '--- WSL ---'
if ($NoWsl) {
    Add-Line '  пропущено (-NoWsl)'
}
else {
    Add-Line ("  версія: " + ((Invoke-Cmd 'wsl.exe' @('--version') -TimeoutSec 30 -Utf16) -split "`n" | Select-Object -First 1))
    $distros = Invoke-Cmd 'wsl.exe' @('-l', '-v') 30
    Add-Line ("  дистрибутиви:" + [Environment]::NewLine + $distros)

    $kernel = (Invoke-Cmd 'wsl.exe' @('-d', 'docker-desktop', '-u', 'root', '--', 'uname', '-r') 30).Trim()
    Add-Line ("  ядро docker-desktop: " + $kernel)
    if ($kernel -notmatch 'microsoft') {
        Add-Line '  ! дистрибутив не відповів — далі відбиток не перевірити'
    }
    else {
        $modules = "/lib/modules/$kernel/modules.dep"
        $wc = Invoke-Cmd 'wsl.exe' @('-d', 'docker-desktop', '-u', 'root', '--', 'wc', '-l', '-c', $modules) 30
        Add-Line ("  ВІДБИТОК modules.dep (рядків/байтів): " + $wc)
        $m = [regex]::Match($wc, '(?m)^\s*(\d+)\s')
        $lines = if ($m.Success) { $m.Groups[1].Value } else { '' }
        if ($lines -eq '0') {
            Add-Line '  >>> ДІАГНОЗ: індекс модулів зламаний (0 LF) -> немає iso9660 -> двигун не стартує.'
            Add-Line '  >>> Лік: scripts\docker-recover.ps1 -Fix  (оновити WSL)'
        }
        else {
            Add-Line '  індекс модулів цілий (рядків > 0) — ця причина відпадає'
        }
        Add-Line ("  iso9660 у /proc/filesystems: " + (Invoke-Cmd 'wsl.exe' @('-d', 'docker-desktop', '-u', 'root', '--', 'grep', '-c', 'iso9660', '/proc/filesystems') 30))
    }
}
Add-Line ''

Add-Line '--- Лог Docker Desktop ---'
$log = "$env:LOCALAPPDATA\Docker\log\host\com.docker.backend.exe.log"
if (Test-Path -LiteralPath $log) {
    $size = [math]::Round((Get-Item -LiteralPath $log).Length / 1MB, 1)
    Add-Line ("  файл: " + $log + "  (" + $size + " МБ)")
    $hits = @(Select-String -LiteralPath $log -Pattern 'unknown filesystem type' -SimpleMatch -ErrorAction SilentlyContinue)
    Add-Line ("  згадок 'unknown filesystem type': " + $hits.Count)
    if ($hits.Count -gt 0) {
        Add-Line ("  остання: " + $hits[-1].Line.Trim())
    }
    $ping = @(Select-String -LiteralPath $log -Pattern 'context deadline exceeded' -SimpleMatch -ErrorAction SilentlyContinue)
    Add-Line ("  згадок 'context deadline exceeded' (двигун не відповідає): " + $ping.Count)
    Add-Line '  --- останні 8 рядків ---'
    foreach ($l in (Get-Content -LiteralPath $log -Tail 8)) {
        Add-Line ('    ' + $l.Substring(0, [Math]::Min(200, $l.Length)))
    }
}
else {
    Add-Line '  лог не знайдено'
}
Add-Line ''

Add-Line '--- Диски та vhdx ---'
foreach ($d in (Get-PSDrive -PSProvider FileSystem)) {
    if ($d.Free -ne $null -and $d.Used -ne $null) {
        Add-Line ("  " + $d.Name + ": вільно " + [math]::Round($d.Free / 1GB, 1) + " ГБ")
    }
}
$vhdx = Get-ChildItem "$env:LOCALAPPDATA\Docker\wsl" -Recurse -Filter *.vhdx -ErrorAction SilentlyContinue
foreach ($v in $vhdx) {
    Add-Line ("  " + [math]::Round($v.Length / 1GB, 2) + " ГБ  " + $v.FullName)
}
Add-Line ''

Add-Line '--- Події Kernel-EventTracing ID 2 (WSLg-шторм) за добу ---'
$ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-Kernel-EventTracing/Admin'; Id = 2; StartTime = (Get-Date).AddDays(-1) } -ErrorAction SilentlyContinue)
Add-Line ("  кількість: " + $ev.Count)
if ($ev.Count -gt 0) {
    Add-Line ("  остання: " + $ev[0].TimeCreated + "  " + $ev[0].Message)
}
Add-Line ''

Add-Line '--- Контейнери (якщо двигун живий) ---'
$cli = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
if (Test-Path -LiteralPath $cli) {
    Add-Line ((Invoke-Cmd $cli @('ps', '-a', '--format', '{{.Names}}  {{.Image}}  {{.Status}}  {{.Ports}}') 30))
    Add-Line ("  томи:" + [Environment]::NewLine + (Invoke-Cmd $cli @('volume', 'ls') 30))
}
else {
    Add-Line '  docker.exe не знайдено'
}

$report -join "`r`n" | Out-File -FilePath $reportPath -Encoding UTF8
Write-Host ''
Write-Host ("Звіт збережено: " + $reportPath) -ForegroundColor Green
