<#
  Запуск DesignCraft разом зі Студією: сервер Студії + MCP-сервери + вибір книги.

  Що робить (у такому порядку):
   1. Запускає/перезапускає сервер Студії (npm run dev) і чекає, поки він відповість.
   2. Просить увійти в акаунт Студії (відкриває її в браузері) і перевіряє токен автора.
   3. Відкриває ВІКНО DesignCraft (designcraft.exe --control ПОРТ) і перевіряє, що агент може ним керувати
      (designcraft-cli mcp --connect ПОРТ). Автор бачить книгу наживо; з -Headless — невидима сесія.
   4. Лише після цього бере з Студії перелік книг автора й пропонує обрати одну.
   5. Питає, під яким акаунтом і з якою моделлю запускати Claude Code (щоб не палити дорогу модель).
   6. Запускає Claude Code з двома MCP-серверами: nova-studio (читає рукопис) і
      designcraft (верстка), із початковим завданням на обрану книгу.

  Токен автора (nst_...) — Студія: Медіатека -> Скани з телефону -> Підключення застосунку.
  Скрипт бере його зі змінної NOVA_STUDIO_TOKEN або зі свого зашифрованого файлу
  (%LOCALAPPDATA%\nova-studio\token.dpapi; шифр прив'язаний до вашого Windows-облікового запису),
  а якщо немає ні того, ні того — питає приховано. У репозиторій токен не потрапляє.

  Приклади:
    scripts\start-designcraft-studio.cmd
    scripts\start-designcraft-studio.cmd -StudioUrl https://fusionlab.in.ua/studio
    scripts\start-designcraft-studio.cmd -BookId book-abc123
    scripts\start-designcraft-studio.cmd -KeepRunning     (не перезапускати працюючу Студію)

  Кнопка «Відкрити графічний редактор DesignCraft» у Студії викликає цей скрипт через посилання
  designcraft-studio://open?book=...&studio=... (його реєструє scripts\install-designcraft-link.cmd).
  Адреса Студії з посилання приймається ЛИШЕ зі списку дозволених: інакше чужа сторінка могла б
  змусити скрипт надіслати ваш токен на свій сервер.
#>
[CmdletBinding()]
param(
  [string]$StudioUrl = 'http://localhost:3000',
  [string]$DesignCraftPath = 'D:\Rama\designcraft\target\release\designcraft-cli.exe',
  [string]$DesignCraftAppPath = 'D:\Rama\designcraft\target\release\designcraft.exe',   # вікно (GUI) DesignCraft
  [int]$ControlPort = 7979,        # порт керування вікном DesignCraft (designcraft --control)
  [switch]$Headless,               # без вікна: невидима сесія в пам'яті (як було раніше)
  [string]$BookId = '',
  [switch]$NoStudio,
  [switch]$KeepRunning,   # не перезапускати Студію, якщо вона вже працює
  [ValidateSet('', 'sonnet', 'haiku', 'opus', 'default')][string]$Model = '',   # модель Claude Code; порожньо = спитати
  [ValidateSet('', 'current', 'books', 'subscription')][string]$Account = '',   # акаунт Claude Code; порожньо = спитати
  [switch]$NoLoginCheck,   # не перевіряти вхід у Claude Code перед запуском
  [switch]$NoBrowser,     # не відкривати Студію в браузері для входу
  [switch]$ForgetToken,
  [string]$Url = '',               # designcraft-studio://open?book=...&studio=... (з кнопки в Студії)
  [string[]]$AllowedStudio = @()   # додаткові дозволені адреси Студії для посилання
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot 'designcraft-work'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'last-run.log'
# Журнал останнього запуску: токен у нього не потрапляє (лише початок «nst_xxx...» при вставці з буфера).
try { Start-Transcript -Path $LogFile -Force | Out-Null } catch { }
$FromLink = [bool]$Url
function Wait-BeforeClose {
  # Вікно, відкрите посиланням із браузера, інакше закрилося б разом із текстом.
  if ($FromLink) { try { Read-Host 'Натисніть Enter, щоб закрити вікно' | Out-Null } catch { } }
}

# Адреси Студії, яким можна довірити токен, коли запуск іде з посилання.
$DefaultAllowedStudios = @(
  'https://www.fusionlab.in.ua/studio',
  'https://fusionlab.in.ua/studio',
  'https://app.fusionlab.in.ua/studio',
  'https://bookcreator-production-7304.up.railway.app'
)
function Test-AllowedStudio([string]$root) {
  $r = $root.TrimEnd('/').ToLowerInvariant()
  if ($r -match '^http://(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$') { return $true }
  $extra = @($AllowedStudio) + @(("$env:DESIGNCRAFT_ALLOWED_STUDIOS" -split ';') | Where-Object { $_ })
  foreach ($a in @($DefaultAllowedStudios) + $extra) { if ($r -eq "$a".TrimEnd('/').ToLowerInvariant()) { return $true } }
  return $false
}

if ($FromLink) {
  if ($Url -notmatch '^designcraft-studio://') {
    Write-Host "Помилка: це не посилання DesignCraft-Studio: $Url" -ForegroundColor Red; Wait-BeforeClose; exit 1
  }
  $query = @{}
  $qs = ($Url -split '\?', 2)[1]
  foreach ($pair in ("$qs" -split '&')) {
    if (-not $pair) { continue }
    $kv = $pair -split '=', 2
    $query[[Uri]::UnescapeDataString($kv[0])] = if ($kv.Count -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { '' }
  }
  $linkStudio = "$($query['studio'])".TrimEnd('/')
  $linkBook = "$($query['book'])"
  if (-not (Test-AllowedStudio $linkStudio)) {
    Write-Host "Помилка: адреса Студії «$linkStudio» не в списку дозволених. Якщо це справді ваша Студія, запустіть скрипт з -AllowedStudio $linkStudio або додайте її в змінну DESIGNCRAFT_ALLOWED_STUDIOS." -ForegroundColor Red
    Wait-BeforeClose; exit 1
  }
  if ($linkBook -and $linkBook -notmatch '^[A-Za-z0-9_.\-]{1,100}$') {
    Write-Host "Помилка: недопустимий ідентифікатор книги в посиланні." -ForegroundColor Red; Wait-BeforeClose; exit 1
  }
  $StudioUrl = $linkStudio
  if ($linkBook) { $BookId = $linkBook }
  # Кнопку натиснули в самій Студії — отже, сервер працює; не перезапускаємо його під сторінкою.
  $KeepRunning = $true
  Write-Host "Запуск із Студії: $StudioUrl, книга $BookId" -ForegroundColor Cyan
}

$StudioUrl = $StudioUrl.TrimEnd('/')
# Токен прив'язаний до конкретної Студії: локальна й хмарна мають різні акаунти й токени.
$studioKey = -join ([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($StudioUrl.ToLowerInvariant())) | Select-Object -First 6 | ForEach-Object { $_.ToString('x2') })
$TokenFile = Join-Path $env:LOCALAPPDATA "nova-studio\token-$studioKey.dpapi"
$LegacyTokenFile = Join-Path $env:LOCALAPPDATA 'nova-studio\token.dpapi'   # старий файл — лише для локальної Студії

function Fail($msg) {
  Write-Host ''
  Write-Host "Помилка: $msg" -ForegroundColor Red
  Write-Host "Журнал запуску: $LogFile"
  try { Stop-Transcript | Out-Null } catch { }
  Wait-BeforeClose
  exit 1
}

# --- GET JSON з коректним UTF-8 (Windows PowerShell 5.1 інакше ламає кирилицю) -----------------
function Get-Json([string]$Path, [string]$Token) {
  $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/json' }
  try {
    $r = Invoke-WebRequest -Uri "$StudioUrl$Path" -Headers $headers -UseBasicParsing -TimeoutSec 30
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and [int]$resp.StatusCode -eq 401) { return @{ __status = 401 } }
    if ($resp -and [int]$resp.StatusCode -eq 403) { return @{ __status = 403 } }
    throw
  }
  $ms = New-Object System.IO.MemoryStream
  $r.RawContentStream.CopyTo($ms)
  $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
  return ($text | ConvertFrom-Json)
}

# --- 0. Попередні перевірки ---------------------------------------------------------------------
if ($ForgetToken) {
  if (Test-Path $TokenFile) { Remove-Item $TokenFile -Force; Write-Host 'Збережений токен видалено.' }
  else { Write-Host 'Збереженого токена немає.' }
  exit 0
}
if (-not (Test-Path (Join-Path $RepoRoot 'package.json'))) { Fail "Не знайдено проєкт Студії в $RepoRoot." }
if (-not (Test-Path $DesignCraftPath)) { Fail "Не знайдено DesignCraft: $DesignCraftPath (параметр -DesignCraftPath)." }
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { Fail 'Не знайдено команду claude (Claude Code).' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail 'Не знайдено node.' }

# --- 1. Сервер Студії ---------------------------------------------------------------------------
$uri = [System.Uri]$StudioUrl
$isLocal = @('localhost', '127.0.0.1', '[::1]') -contains $uri.Host
$studioProc = $null

function Test-StudioUp {
  try { Invoke-WebRequest -Uri $StudioUrl -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true }
  catch { return ($_.Exception.Response -ne $null) }  # будь-яка HTTP-відповідь = сервер живий
}

# Чи належить процес Студії цього проєкту (щоб не зупинити чужий процес на тому ж порту).
function Test-IsStudioProcess([int]$ProcId) {
  $info = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcId" -ErrorAction SilentlyContinue
  if (-not $info) { return $false }
  $cmd = "$($info.CommandLine)"
  return ($info.Name -match '^(node|tsx)(\.exe)?$') -and
         ($cmd -match 'server\.ts' -or $cmd -match 'vite' -or $cmd.ToLower().Contains($RepoRoot.ToLower()))
}

function Get-ListenerPids([int[]]$Ports) {
  @(Get-NetTCPConnection -LocalPort $Ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

if ($isLocal -and -not $NoStudio) {
  # Порти: сервер Студії і канал гарячого оновлення Vite (24678 — з ним був конфлікт раніше).
  $ports = @($uri.Port, 24678)
  $pids = Get-ListenerPids $ports

  if ($pids.Count -gt 0 -and $KeepRunning -and (Test-StudioUp)) {
    Write-Host "Студія вже працює на $StudioUrl — залишаю як є (-KeepRunning)." -ForegroundColor Green
  } else {
    if ($pids.Count -gt 0) {
      Write-Host "Студія вже запущена (PID: $($pids -join ', ')) — перезапускаю." -ForegroundColor Yellow
      foreach ($procId in $pids) {
        if (-not (Test-IsStudioProcess $procId)) {
          $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
          Fail "Порт зайнятий процесом $name (PID $procId), який не схожий на Студію цього проєкту. Закрийте його вручну і повторіть."
        }
      }
      foreach ($procId in $pids) { & taskkill /PID $procId /T /F 2>&1 | Out-Null }
      $deadline = (Get-Date).AddSeconds(20)
      while ((Get-ListenerPids $ports).Count -gt 0) {
        if ((Get-Date) -gt $deadline) { Fail 'Порти Студії не звільнилися за 20 с. Закрийте процес вручну.' }
        Start-Sleep -Milliseconds 500
      }
      Write-Host 'Стару Студію зупинено.'
    }
    Write-Host "Запускаю сервер Студії (npm run dev) у новому вікні..."
    $studioProc = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList '/k', "cd /d `"$RepoRoot`" && title Студія (сервер) && npm run dev" `
      -PassThru
    $deadline = (Get-Date).AddSeconds(120)
    while (-not (Test-StudioUp)) {
      if ((Get-Date) -gt $deadline) { Fail 'Студія не відповіла за 120 с. Дивіться вікно «Студія (сервер)».' }
      if ($studioProc.HasExited) { Fail 'Сервер Студії завершився одразу. Дивіться його вікно.' }
      Start-Sleep -Seconds 2
    }
    Write-Host 'Студія відповідає.' -ForegroundColor Green
  }
} elseif (-not (Test-StudioUp)) {
  Fail "Студія недоступна за адресою $StudioUrl."
}

# --- 2. Вхід у Студію (токен автора) -----------------------------------------------------------
$script:secureToken = $null

# Обмін одноразового коду підключення (кнопка «Отримати код підключення» у Студії) на токен.
function Invoke-PairCode([string]$code) {
  $body = @{ code = $code } | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  try {
    $r = Invoke-WebRequest -Uri "$StudioUrl/api/external/v1/pair" -Method Post -ContentType 'application/json; charset=utf-8' -Body $bytes -UseBasicParsing -TimeoutSec 30
  } catch {
    $resp = $_.Exception.Response
    $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
    $why = switch ($status) {
      404 { 'код невірний або вже використаний' }
      410 { 'код прострочений (живе 5 хвилин)' }
      429 { 'забагато невдалих спроб — зачекайте 10 хвилин' }
      409 { 'у вас уже максимум підключених застосунків — відкличте зайвий у Студії' }
      default { "Студія недоступна ($($_.Exception.Message))" }
    }
    Write-Host "Код не прийнято: $why." -ForegroundColor Yellow
    return ''
  }
  $ms = New-Object System.IO.MemoryStream
  $r.RawContentStream.CopyTo($ms)
  $data = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
  Write-Host 'Код прийнято: застосунок підключено до вашого акаунта.' -ForegroundColor Green
  return "$($data.token)"
}

function Request-TokenFromUser {
  if (-not $NoBrowser) {
    $page = if ($BookId) { "$StudioUrl/projects/$BookId/pdf-editor" } else { $StudioUrl }
    Write-Host 'Відкриваю Студію в браузері: увійдіть у свій акаунт, якщо ще не ввійшли.' -ForegroundColor Cyan
    try { Start-Process $page } catch { }
  }
  Write-Host 'Підключення до акаунта Студії:' -ForegroundColor Cyan
  Write-Host '  - Код підключення: «Верстка для публікації» -> «Отримати код підключення» (8 символів, живе 5 хв).'
  Write-Host '  - Або токен: Медіатека -> Скани з телефону -> Підключення застосунку -> Створити токен -> копіювати.'
  $answer = (Read-Host 'Введіть код підключення, або Enter = взяти токен з буфера обміну, 2 = ввести токен вручну').Trim()
  if ($answer -match '^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$') {
    $script:secureToken = $null
    return (Invoke-PairCode $answer)
  }
  if ($answer -eq '2') {
    $script:secureToken = Read-Host 'Токен (вводиться приховано)' -AsSecureString
    return [System.Net.NetworkCredential]::new('', $script:secureToken).Password.Trim()
  }
  if ($answer) { Write-Host 'Це не схоже ні на код (XXXX-XXXX), ні на вибір 2.' -ForegroundColor Yellow; return '' }
  $clip = ''
  try { $clip = [string](Get-Clipboard -Raw) } catch { $clip = '' }
  $tok = ("$clip" -replace '\s', '')
  if (-not $tok) { Write-Host 'Буфер обміну порожній.' -ForegroundColor Yellow; return '' }
  if ($tok -match '^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$') { $script:secureToken = $null; return (Invoke-PairCode $tok) }
  if ($tok -notmatch '^nst_') { Write-Host 'У буфері обміну ні код підключення, ні токен nst_...' -ForegroundColor Yellow; return '' }
  Write-Host ("Токен узято з буфера обміну: {0}... ({1} символів)" -f $tok.Substring(0, 7), $tok.Length) -ForegroundColor Green
  try { Set-Clipboard -Value ' ' } catch { }   # не лишаємо секрет у буфері обміну
  $script:secureToken = $null
  return $tok
}

$token = ("$env:NOVA_STUDIO_TOKEN").Trim()
$fromFile = $false
if (-not $token -and -not (Test-Path $TokenFile) -and $isLocal -and (Test-Path $LegacyTokenFile)) {
  # Токен, збережений попередньою версією скрипта, належить локальній Студії.
  Copy-Item $LegacyTokenFile $TokenFile -Force
}
if (-not $token -and (Test-Path $TokenFile)) {
  try {
    $script:secureToken = (Get-Content $TokenFile -Raw).Trim() | ConvertTo-SecureString
    $token = [System.Net.NetworkCredential]::new('', $script:secureToken).Password
    $fromFile = $true
  } catch {
    Write-Host 'Збережений токен не вдалося прочитати (інший обліковий запис?). Введіть заново.' -ForegroundColor Yellow
  }
}

$user = $null
$entered = $false
for ($attempt = 1; $attempt -le 3 -and -not $user; $attempt++) {
  if (-not $token) { $token = Request-TokenFromUser; $entered = [bool]$token; if (-not $token) { continue } }
  if ($token -notmatch '^nst_') { Write-Host 'Токен має починатися з nst_ — це особистий токен Студії, а не пароль.' -ForegroundColor Yellow; $token = ''; continue }
  $me = Get-Json '/api/external/v1/me' $token
  if ($me -is [hashtable] -and $me.__status) {
    Write-Host 'Студія не прийняла токен (він недійсний, відкликаний або створений на іншому сервері). Потрібен новий.' -ForegroundColor Yellow
    if ($fromFile -and (Test-Path $TokenFile)) { Remove-Item $TokenFile -Force; Write-Host 'Збережений токен видалено.' }
    $token = ''; $fromFile = $false; $env:NOVA_STUDIO_TOKEN = ''
    continue
  }
  $user = if ($me.user) { $me.user } else { $me }
}
if (-not $user) { Fail 'Не вдалося увійти в Студію: токен не прийнято за 3 спроби.' }
Write-Host ("Ви ввійшли як: {0} ({1})" -f $user.name, $user.email) -ForegroundColor Cyan

if ($entered) {
  $save = Read-Host 'Зберегти токен зашифрованим для вашого Windows-облікового запису? (y/N)'
  if ($save -match '^[yYтТ]') {
    if (-not $script:secureToken) { $script:secureToken = ConvertTo-SecureString $token -AsPlainText -Force }
    New-Item -ItemType Directory -Force -Path (Split-Path $TokenFile) | Out-Null
    ($script:secureToken | ConvertFrom-SecureString) | Set-Content -Path $TokenFile -Encoding ASCII
    Write-Host "Збережено для цієї Студії ($TokenFile). Видалити: -ForgetToken."
  }
}

# --- 3. DesignCraft: вікно + канал керування (або невидима сесія з -Headless) --------------------
# Режим вікна: designcraft.exe --control ПОРТ показує книгу наживо, а `designcraft-cli mcp --connect ПОРТ`
# дає Claude Code керувати САМЕ ЦИМ вікном: усе, що робить агент, письменник бачить в інтерфейсі.
# Режим -Headless: `designcraft-cli mcp` — процес на stdio без вікна (його запускає Claude Code).
function Test-ControlPortListening {
  [bool](Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue)
}

function Test-DesignCraftServer([string[]]$McpArgs) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $DesignCraftPath
  $psi.Arguments = ($McpArgs -join ' ')
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $p = [System.Diagnostics.Process]::Start($psi)
  try {
    $req = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"start-designcraft-studio","version":"1"}}}'
    # Пишемо БАЙТИ напряму: StreamWriter у PowerShell 5.1 (chcp 65001) ставить на початок BOM,
    # і Rust-сервер читає його як сміття («parse error: expected value at line 1 column 1»).
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($req + "`n")
    $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $p.StandardInput.BaseStream.Flush()
    $task = $p.StandardOutput.ReadLineAsync()
    if (-not $task.Wait(15000)) { return @{ ok = $false; error = 'DesignCraft не відповів за 15 с.' } }
    $line = $task.Result
    if (-not $line) {
      $err = ''
      if ($p.HasExited) { $err = $p.StandardError.ReadToEnd() }
      return @{ ok = $false; error = "DesignCraft завершився без відповіді. $err".Trim() }
    }
    $resp = $line | ConvertFrom-Json
    if ($resp.error) { return @{ ok = $false; error = "DesignCraft відповів помилкою: $($resp.error.message)" } }
    $info = $resp.result.serverInfo
    return @{ ok = $true; name = "$($info.name)"; version = "$($info.version)" }
  } finally {
    try { $p.StandardInput.Close() } catch { }
    try { if (-not $p.WaitForExit(3000)) { $p.Kill() } } catch { }
  }
}

$designcraftArgs = @('mcp')
if ($Headless) {
  Write-Host 'Режим -Headless: DesignCraft без вікна (невидима сесія).' -ForegroundColor Yellow
} else {
  if (-not (Test-Path $DesignCraftAppPath)) {
    Fail "Не знайдено вікно DesignCraft: $DesignCraftAppPath. Збудуйте його: cargo build --release -p designcraft (у D:\Rama\designcraft) або вкажіть -DesignCraftAppPath."
  }
  if (Test-ControlPortListening) {
    Write-Host "Вікно DesignCraft уже відкрите (порт керування $ControlPort) — підключаюсь до нього." -ForegroundColor Green
  } else {
    Write-Host "Відкриваю вікно DesignCraft (designcraft.exe --control $ControlPort)..." -ForegroundColor Cyan
    $dcApp = Start-Process -FilePath $DesignCraftAppPath -ArgumentList @('--control', "$ControlPort") `
      -WorkingDirectory (Split-Path -Parent $DesignCraftAppPath) -PassThru
    $deadline = (Get-Date).AddSeconds(60)
    while (-not (Test-ControlPortListening)) {
      if ($dcApp.HasExited) { Fail "Вікно DesignCraft завершилось одразу (код $($dcApp.ExitCode))." }
      if ((Get-Date) -gt $deadline) { Fail "Вікно DesignCraft не відкрило порт керування $ControlPort за 60 с." }
      Start-Sleep -Milliseconds 500
    }
    Write-Host 'Вікно DesignCraft відкрите.' -ForegroundColor Green
  }
  $designcraftArgs = @('mcp', '--connect', "$ControlPort")
}

$dc = Test-DesignCraftServer $designcraftArgs
if (-not $dc.ok) { Fail $dc.error }
if ($Headless) {
  Write-Host ("DesignCraft запущений і відповідає: {0} {1}" -f $dc.name, $dc.version) -ForegroundColor Green
  Write-Host 'Далі його запустить Claude Code (MCP-процес на stdio) — ця перевірка лише підтверджує, що він справний.'
} else {
  Write-Host ("Агент зможе керувати вікном DesignCraft: {0} {1} (порт {2})" -f $dc.name, $dc.version, $ControlPort) -ForegroundColor Green
}

# --- 4. Книги автора ------------------------------------------------------------------------------
$list = Get-Json '/api/external/v1/books' $token
if ($list -is [hashtable] -and $list.__status) { Fail 'Студія не віддала перелік книг (401/403). Перевірте токен.' }
# PowerShell розгортає масиви при поверненні з функції: один елемент приходить як об'єкт.
$raw = @(@($list) | Where-Object { $_ -ne $null })
$books = @()
if ($raw.Count -eq 1 -and $raw[0].PSObject.Properties['books']) { $books = @($raw[0].books) }
elseif ($raw.Count -eq 1 -and $raw[0].PSObject.Properties['items']) { $books = @($raw[0].items) }
else { $books = @($raw | Where-Object { $_.PSObject.Properties['id'] }) }
if ($books.Count -eq 0) {
  Fail 'На сервері немає жодної вашої книги. Відкрийте книгу в Студії й натисніть «Зберегти» — серверна копія створюється при збереженні.'
}

$chosen = $null
if ($BookId) {
  $chosen = $books | Where-Object { $_.id -eq $BookId } | Select-Object -First 1
  if (-not $chosen) { Fail "Книги $BookId немає серед ваших книг на сервері." }
} else {
  Write-Host ''
  Write-Host 'Ваші книги на сервері (найновіші зверху):'
  for ($i = 0; $i -lt $books.Count; $i++) {
    $b = $books[$i]
    Write-Host ("  {0,2}. {1}   [{2}]   оновлено {3}" -f ($i + 1), $b.title, $b.id, $b.updatedAt)
  }
  Write-Host ''
  $answer = Read-Host "Яку книгу передати в DesignCraft? Номер (Enter = 1, q = вихід)"
  if ($answer -match '^[qQ]') { Write-Host 'Скасовано.'; exit 0 }
  if (-not $answer) { $answer = '1' }
  $n = 0
  if (-not [int]::TryParse($answer, [ref]$n) -or $n -lt 1 -or $n -gt $books.Count) { Fail "Немає книги з номером «$answer»." }
  $chosen = $books[$n - 1]
}
Write-Host ("Обрано: {0} [{1}]" -f $chosen.title, $chosen.id) -ForegroundColor Green

# --- 4б. Чернетка верстки зі Студії (той самий конвеєр DesignCraft, що й точний PDF) ---------------
$workDir = Join-Path $RepoRoot 'designcraft-work'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$draftPath = Join-Path $workDir "$($chosen.id).designcraft"
$resultPdfPath = Join-Path $workDir "$($chosen.id).pdf"
$revisionPath = Join-Path $workDir "$($chosen.id).revision"

function Get-StudioDraft {
  Write-Host 'Готую чернетку на сервері Студії (DesignCraft, шаблон і макет книги)...' -ForegroundColor Cyan
  try {
    $r = Invoke-WebRequest -Uri "$StudioUrl/api/external/v1/books/$($chosen.id)/designcraft-draft" -Method Post `
      -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 300
  } catch {
    $resp = $_.Exception.Response
    $status = if ($resp) { [int]$resp.StatusCode } else { 0 }
    Write-Host "Чернетку не отримано (HTTP $status). Агент створить документ сам." -ForegroundColor Yellow
    return $false
  }
  if (Test-Path $draftPath) { Copy-Item $draftPath "$draftPath.bak" -Force; Write-Host "Попередню чернетку збережено як $draftPath.bak" }
  $ms = New-Object System.IO.MemoryStream
  $r.RawContentStream.CopyTo($ms)
  [System.IO.File]::WriteAllBytes($draftPath, $ms.ToArray())
  $rev = "$($r.Headers['X-Book-Revision'])"
  Set-Content -Path $revisionPath -Value $rev -Encoding ASCII
  Write-Host ("Чернетку збережено: {0} (ревізія книги {1}, сторінок {2})" -f $draftPath, $rev, "$($r.Headers['X-Pdf-Pages'])") -ForegroundColor Green
  return $true
}


function Send-StudioResult([string]$file, [string]$kind, [string]$rev) {
  try {
    $resp = Invoke-WebRequest -Uri "$StudioUrl/api/external/v1/books/$($chosen.id)/designcraft-result/$kind" -Method Put `
      -Headers @{ Authorization = "Bearer $token"; 'X-Book-Revision' = $rev } -ContentType 'application/octet-stream' `
      -Body ([System.IO.File]::ReadAllBytes($file)) -UseBasicParsing -TimeoutSec 300
    $ms = New-Object System.IO.MemoryStream
    $resp.RawContentStream.CopyTo($ms)
    $info = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
    $mark = if ($info.stale) { " — увага: книгу в Студії вже змінено (ревізія $($info.currentRevision)), результат позначено застарілим" } else { '' }
    Write-Host "Повернуто в Студію: $kind$mark" -ForegroundColor Green
    return $info
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
    Write-Host "Не вдалося повернути $kind (HTTP $status)." -ForegroundColor Yellow
    return $null
  }
}

if (Test-Path $draftPath) {
  $ans = Read-Host "Чернетка вже є ($draftPath). Оновити її з Студії? Локальні правки підуть у .bak (y/N)"
  if ($ans -match '^[yYтТ]') { [void](Get-StudioDraft) }
} else {
  $ans = Read-Host 'Підготувати чернетку на сервері Студії, щоб вікно DesignCraft відкрило ту саму верстку, що й точний PDF? (Y/n)'
  if ($ans -notmatch '^[nNнН]') { [void](Get-StudioDraft) }
}
$startStamp = @{}
foreach ($f in @($draftPath, $resultPdfPath)) { $startStamp[$f] = if (Test-Path $f) { (Get-Item $f).LastWriteTimeUtc } else { $null } }

# --- 5. Claude Code: акаунт і модель --------------------------------------------------------------
# Вибір запам'ятовується в designcraft-work\prefs.json (Enter = як минулого разу).
$PrefsFile = Join-Path $LogDir 'prefs.json'
$prefs = @{ account = 'current'; model = 'sonnet' }
if (Test-Path $PrefsFile) {
  try {
    $saved = Get-Content $PrefsFile -Raw | ConvertFrom-Json
    if ($saved.account) { $prefs.account = "$($saved.account)" }
    if ($saved.model) { $prefs.model = "$($saved.model)" }
  } catch { }
}

Write-Host ''
if (-not $Account) {
  Write-Host 'Під яким акаунтом запускати Claude Code?' -ForegroundColor Cyan
  Write-Host '  1. Поточний акаунт Claude Code (як зараз)'
  Write-Host '  2. Окремий профіль «для книг»: свій вхід, не чіпає основний (перший раз Claude Code попросить увійти)'
  Write-Host '  3. Як поточний, але ігнорувати ключ ANTHROPIC_API_KEY (вхід через підписку claude.ai)'
  $map = @{ '1' = 'current'; '2' = 'books'; '3' = 'subscription' }
  $defNum = (@($map.Keys) | Where-Object { $map[$_] -eq $prefs.account } | Select-Object -First 1)
  if (-not $defNum) { $defNum = '1' }
  $ans = Read-Host "Номер (Enter = $defNum)"
  if (-not $ans) { $ans = $defNum }
  if (-not $map.ContainsKey($ans)) { Fail "Немає варіанта акаунта «$ans»." }
  $Account = $map[$ans]
}

if (-not $Model) {
  Write-Host ''
  Write-Host 'Яку модель Claude Code використовувати?' -ForegroundColor Cyan
  Write-Host '  1. Sonnet — збалансована, помітно дешевша за Opus (рекомендовано для книг)'
  Write-Host '  2. Haiku  — найдешевша і найшвидша, простіші завдання'
  Write-Host '  3. Opus   — найпотужніша і НАЙДОРОЖЧА'
  Write-Host '  4. Модель за замовчуванням вашого акаунта (може бути Opus)'
  $mmap = @{ '1' = 'sonnet'; '2' = 'haiku'; '3' = 'opus'; '4' = 'default' }
  $defM = (@($mmap.Keys) | Where-Object { $mmap[$_] -eq $prefs.model } | Select-Object -First 1)
  if (-not $defM) { $defM = '1' }
  $ans = Read-Host "Номер (Enter = $defM)"
  if (-not $ans) { $ans = $defM }
  if (-not $mmap.ContainsKey($ans)) { Fail "Немає варіанта моделі «$ans»." }
  $Model = $mmap[$ans]
}
try { (@{ account = $Account; model = $Model } | ConvertTo-Json) | Set-Content -Path $PrefsFile -Encoding UTF8 } catch { }

# Налаштування середовища тільки для запуску claude (після виходу відновлюються).
$savedEnv = @{
  CLAUDE_CONFIG_DIR = $env:CLAUDE_CONFIG_DIR
  ANTHROPIC_API_KEY = $env:ANTHROPIC_API_KEY
}
if ($Account -eq 'books') {
  $env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE '.claude-books'
  Write-Host ("Профіль для книг: {0}" -f $env:CLAUDE_CONFIG_DIR) -ForegroundColor Yellow
  if (-not (Test-Path (Join-Path $env:CLAUDE_CONFIG_DIR '.claude.json'))) {
    Write-Host 'Це перший запуск профілю: Claude Code попросить увійти — оберіть потрібний акаунт.' -ForegroundColor Yellow
  }
}
if ($Account -eq 'subscription') {
  Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue
  Write-Host 'ANTHROPIC_API_KEY для цього запуску ігнорується.' -ForegroundColor Yellow
}
$modelArgs = @()
if ($Model -ne 'default') { $modelArgs = @('--model', $Model) }
Write-Host ("Акаунт: {0}; модель: {1}" -f $Account, $Model) -ForegroundColor Green

# --- 5б. Вхід у Claude Code через браузер ---------------------------------------------------------
# `claude auth status` показує, чи є вхід у ПОТОЧНОМУ профілі (з урахуванням CLAUDE_CONFIG_DIR вище);
# `claude auth login` відкриває браузер для входу. Якщо цих команд у вашій версії немає, скрипт нічого
# не ламає: Claude Code сам запропонує вхід при запуску.
function Get-ClaudeLoginState {
  try {
    $out = (& claude auth status 2>&1 | Out-String).Trim()
    $code = $LASTEXITCODE
    $info = $null
    try { $info = $out | ConvertFrom-Json } catch { }
    if ($info -and $info.PSObject.Properties['loggedIn']) {
      return @{ known = $true; loggedIn = [bool]$info.loggedIn; info = $info; text = $out }
    }
    if ($out -match '(?i)not logged in|not authenticated') { return @{ known = $true; loggedIn = $false; info = $null; text = $out } }
    if ($code -eq 0 -and $out) { return @{ known = $true; loggedIn = $true; info = $null; text = $out } }
    return @{ known = $false; text = $out }
  } catch {
    return @{ known = $false; text = "$($_.Exception.Message)" }
  }
}

function Invoke-ClaudeLogin {
  Write-Host ''
  Write-Host 'Як увійти в Claude Code?' -ForegroundColor Cyan
  Write-Host '  1. Акаунт Claude (підписка Pro/Max) — без API-кредитів'
  Write-Host '  2. Anthropic Console (API, оплата з кредитів організації)'
  $kind = Read-Host 'Номер (Enter = 1)'
  Write-Host 'Відкриваю браузер для входу в Claude Code. Увійдіть у потрібний акаунт і поверніться сюди...' -ForegroundColor Cyan
  if ($kind -eq '2') { & claude auth login --console } else { & claude auth login }
}

if (-not $NoLoginCheck) {
  # Профіль CLI `ant` разом із входом через /login дає конфлікт: «Both profile and /login managed key set».
  $antProfiles = Join-Path $env:USERPROFILE '.config\anthropic\configs'
  if ((Test-Path $antProfiles) -and (Get-ChildItem $antProfiles -ErrorAction SilentlyContinue)) {
    Write-Host "Увага: знайдено профіль Anthropic CLI ($antProfiles). Разом із входом через /login він може давати конфлікт ключів." -ForegroundColor Yellow
    Write-Host '  Якщо Claude Code покаже «Both profile and /login managed key set» — перейменуйте цю теку або виконайте: ant auth logout' -ForegroundColor Yellow
  }

  $st = Get-ClaudeLoginState
  if (-not $st.known) {
    Write-Host 'Не вдалося перевірити вхід у Claude Code (стара версія?). Якщо потрібно, він сам запропонує вхід при запуску.' -ForegroundColor Yellow
  } elseif ($st.loggedIn) {
    $who = ''
    if ($st.info) {
      $parts = @()
      foreach ($k in 'email', 'organization', 'orgName', 'authMethod', 'subscriptionType') {
        if ($st.info.PSObject.Properties[$k] -and "$($st.info.$k)") { $parts += "$($st.info.$k)" }
      }
      $who = $parts -join ' · '
    }
    Write-Host ("Claude Code: вхід виконано. {0}" -f $who) -ForegroundColor Green
    $again = Read-Host 'Enter = продовжити з цим акаунтом, 2 = увійти в інший акаунт (відкриє браузер)'
    if ($again -eq '2') {
      & claude auth logout
      Invoke-ClaudeLogin
      $st = Get-ClaudeLoginState
      if ($st.known -and -not $st.loggedIn) { Fail 'Вхід у Claude Code не виконано. Запустіть скрипт ще раз.' }
    }
  } else {
    Write-Host 'Claude Code: ви не ввійшли.' -ForegroundColor Yellow
    Invoke-ClaudeLogin
    $st = Get-ClaudeLoginState
    if ($st.known -and -not $st.loggedIn) { Fail 'Вхід у Claude Code не виконано. Запустіть скрипт ще раз.' }
    Write-Host 'Вхід у Claude Code виконано.' -ForegroundColor Green
  }
}

# --- 6. Конфіг MCP (тимчасовий файл з токеном; видаляється наприкінці) ---------------------------
$workDir = Join-Path $RepoRoot 'designcraft-work'
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

$studioMcpScript = Join-Path $RepoRoot 'scripts\studio-mcp.mts'
$config = @{
  mcpServers = @{
    'nova-studio' = @{
      command = 'node'
      args    = @('--import', 'tsx', $studioMcpScript)
      env     = @{ NOVA_STUDIO_TOKEN = $token; NOVA_STUDIO_URL = $StudioUrl }
    }
    'designcraft' = @{
      command = $DesignCraftPath
      args    = $designcraftArgs
    }
  }
}
$cfgPath = Join-Path $env:TEMP ("nova-designcraft-mcp-{0}.json" -f ([guid]::NewGuid().ToString('N')))
[System.IO.File]::WriteAllText($cfgPath, ($config | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
& icacls $cfgPath /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

# Файл верстки цієї книги в designcraft-work: якщо він є — агент відкриває його, а не починає з нуля.
$hasDraft = Test-Path $draftPath
if ($hasDraft) {
  $openInstr = "ВІДКРИЙ ЗАРАЗ цю книгу у вікні DesignCraft: файл верстки вже є - $draftPath. Відкрий його (file.open) у НОВІЙ вкладці й працюй саме з ним: це чернетка ЦІЄЇ книги, не починай з нуля. Першим повідомленням коротко опиши, що в файлі (формат, кількість сторінок, стилі, що вже залито) і чого бракує. Зберігай зміни в цей самий файл, а PDF експортуй у $resultPdfPath - скрипт поверне обидва файли в Студію."
} else {
  $openInstr = "Файлу верстки цієї книги ще немає ($draftPath). Створи НОВИЙ документ (file.new) у новій вкладці, збережи його як $draftPath і залий текст книги з nova-studio; PDF експортуй у $resultPdfPath. Перед цим дай короткий план (формат, поля, стилі) і спитай мене лише про формат та дані, яких бракує."
}
if ($Headless) {
  $modeInstr = 'DesignCraft працює без вікна (невидима сесія).'
} else {
  $modeInstr = "ВІКНО DesignCraft відкрите, порт керування $ControlPort. Письменник дивиться на нього наживо: працюй покроково, після важливих змін коротко пиши, що змінилось, і роби рендер/скріншот сторінки, якщо інструмент є. У вікні вже можуть бути чужі документи (вкладки) - НЕ чіпай, не закривай і не перезаписуй їх: працюй лише у вкладці цієї книги."
}

$prompt = @"
Працюємо з книгою «$($chosen.title)» (bookId: $($chosen.id)) зі Студії. Це головне завдання сесії: поки я не вказав іншого, відкрий цю книгу у вікні DesignCraft і працюй з нею.

1. Через MCP-сервер nova-studio: studio_list_chapters, потім studio_read_book - прочитай рукопис. Коротко назви revision, updatedAt і глави. Тут не зупиняйся й не чекай підтвердження.
2. $openInstr
3. $modeInstr
4. Правила. nova-studio лише ЧИТАЄ: у книгу в Студії нічого не пишемо. Явно сторонній шматок у тексті (не з книги) не верстай і скажи мені про нього, не змінюючи Студію. Підтвердження питай лише для дій, що руйнують наявну верстку (перебудова документа з нуля, видалення сторінок); відкриття книги та звичайна робота підтвердження не потребують. Результат зберігай у designcraft-work (.designcraft / PDF).
"@

# --- 7. Запуск Claude Code з обома MCP -------------------------------------------------------
try {
  Write-Host ''
  Write-Host 'Запускаю Claude Code з MCP nova-studio + designcraft...' -ForegroundColor Cyan
  Set-Location $RepoRoot
  try { Stop-Transcript | Out-Null } catch { }   # інтерактивний claude у журнал не пишемо
  # --mcp-config приймає кілька значень, тому початкове завдання йде ПЕРЕД опціями.
  & claude $prompt @modelArgs --mcp-config $cfgPath --strict-mcp-config

  # --- 8. Повернення результату в Студію -----------------------------------------------------
  $changed = @()
  foreach ($f in @($draftPath, $resultPdfPath)) {
    if ((Test-Path $f) -and ((-not $startStamp[$f]) -or (Get-Item $f).LastWriteTimeUtc -gt $startStamp[$f])) { $changed += $f }
  }
  if ($changed.Count -gt 0) {
    Write-Host ''
    Write-Host 'Змінено у вікні DesignCraft:' -ForegroundColor Cyan
    $changed | ForEach-Object { Write-Host "  $_" }
    $ans = Read-Host 'Повернути ці файли в Студію (артефакти книги; текст у Студії не змінюється)? (Y/n)'
    if ($ans -notmatch '^[nNнН]') {
      $rev = if (Test-Path $revisionPath) { (Get-Content $revisionPath -Raw).Trim() } else { '' }
      if (-not $rev) {
        Write-Host 'Невідомо, з якої ревізії книги почалася верстка (немає .revision) — повернення пропущено. Підготуйте чернетку зі Студії й повторіть.' -ForegroundColor Yellow
      } else {
        foreach ($f in $changed) {
          $kind = if ($f -like '*.pdf') { 'designcraft-pdf' } else { 'designcraft' }
          [void](Send-StudioResult $f $kind $rev)
        }
      }
    }
  }
} finally {
  if (Test-Path $cfgPath) { Remove-Item $cfgPath -Force -ErrorAction SilentlyContinue }
  $env:CLAUDE_CONFIG_DIR = $savedEnv.CLAUDE_CONFIG_DIR
  $env:ANTHROPIC_API_KEY = $savedEnv.ANTHROPIC_API_KEY
  $token = $null
  if ($studioProc -and -not $studioProc.HasExited) {
    Write-Host 'Сервер Студії лишився запущеним у своєму вікні (закрийте його, коли не потрібен).'
  }
  Wait-BeforeClose
}
