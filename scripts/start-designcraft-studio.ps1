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
  [string]$DesignCraftPath = '',       # designcraft-cli.exe; порожньо = знайти (config.json, типові місця) або спитати один раз
  [string]$DesignCraftAppPath = '',    # designcraft.exe (вікно); порожньо = поряд із designcraft-cli.exe
  [int]$ControlPort = 7979,        # порт керування вікном DesignCraft (designcraft --control)
  [string]$DesignCraftVersion = '',    # версія для автозавантаження DesignCraft (напр. 0.7.1); порожньо = остання
  [switch]$InstallFonts,               # встановити шрифти DejaVu без питань, якщо їх немає
  [switch]$SkipFonts,                  # не перевіряти й не встановлювати шрифти DejaVu
  [switch]$InstallDesignCraft,         # завантажити DesignCraft зі сторінки релізів без питань, якщо його не знайдено
  [Alias('NoClaude')][switch]$DesignCraftOnly,   # лише відкрити вікно DesignCraft: без Студії, входу, MCP і Claude Code
  [switch]$Headless,               # без вікна: невидима сесія в пам'яті (як було раніше)
  [string]$BookId = '',
  [switch]$NoStudio,
  [switch]$KeepRunning,   # не перезапускати Студію, якщо вона вже працює
  [ValidateSet('', 'sonnet', 'haiku', 'opus', 'default')][string]$Model = '',   # модель Claude Code; порожньо = спитати
  [ValidateSet('', 'current', 'books', 'subscription')][string]$Account = '',   # акаунт Claude Code; порожньо = спитати
  [switch]$NoLoginCheck,   # не перевіряти вхід у Claude Code перед запуском
  [switch]$NoBrowser,     # не відкривати Студію в браузері для входу
  [switch]$ForgetToken,
  [switch]$ForgetApiKey,           # видалити збережений API-ключ Claude Code (-ForgetToken стосується токена Студії)
  [string]$PairCode = '',          # код підключення (його додає кнопка в Студії; живе 5 хв, діє один раз)
  [string]$Url = '',               # designcraft-studio://open?book=...&studio=... (з кнопки в Студії)
  [string[]]$AllowedStudio = @()   # додаткові дозволені адреси Студії для посилання
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Два способи жити. З репозиторію Студії (scripts\ поряд із package.json) — як було. Окремо, коли
# інсталятор, завантажений зі Студії, поклав скрипти в %LOCALAPPDATA%\DesignCraftStudio: поряд лежить
# studio-mcp.mjs, а файли верстки йдуть у «Документи\DesignCraft-Studio».
$Portable = Test-Path (Join-Path $PSScriptRoot 'studio-mcp.mjs')
if ($Portable) {
  $RepoRoot = $PSScriptRoot
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if (-not $docs) { $docs = Join-Path $HOME 'Documents' }
  $LogDir = Join-Path $docs 'DesignCraft-Studio'
} else {
  $RepoRoot = Split-Path -Parent $PSScriptRoot
  $LogDir = Join-Path $RepoRoot 'designcraft-work'
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'last-run.log'
# Журнал останнього запуску: токен у нього не потрапляє (лише початок «nst_xxx...» при вставці з буфера).
try { Start-Transcript -Path $LogFile -Force | Out-Null } catch { }
$FromLink = [bool]$Url
function Wait-BeforeClose {
  # Вікно, відкрите посиланням із браузера, інакше закрилося б разом із текстом.
  if ($FromLink -or ($Portable -and -not [Console]::IsInputRedirected)) { try { Read-Host 'Натисніть Enter, щоб закрити вікно' | Out-Null } catch { } }
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
  # mode=designcraft — кнопка «Відкрити DesignCraft» (без Claude Code): токен нікуди не йде, адреса Студії не потрібна.
  if ("$($query['mode'])" -eq 'designcraft') { $DesignCraftOnly = $true }
  if (-not $DesignCraftOnly -and -not (Test-AllowedStudio $linkStudio)) {
    Write-Host "Помилка: адреса Студії «$linkStudio» не в списку дозволених. Якщо це справді ваша Студія, запустіть скрипт з -AllowedStudio $linkStudio або додайте її в змінну DESIGNCRAFT_ALLOWED_STUDIOS." -ForegroundColor Red
    Wait-BeforeClose; exit 1
  }
  if ($linkBook -and $linkBook -notmatch '^[A-Za-z0-9_.\-]{1,100}$') {
    Write-Host "Помилка: недопустимий ідентифікатор книги в посиланні." -ForegroundColor Red; Wait-BeforeClose; exit 1
  }
  if ($linkStudio -and (Test-AllowedStudio $linkStudio)) { $StudioUrl = $linkStudio }
  if ($linkBook) { $BookId = $linkBook }
  if ("$($query['code'])" -match '^[A-Za-z0-9]{4}-?[A-Za-z0-9]{4}$') { $PairCode = "$($query['code'])" }
  # Кнопку натиснули в самій Студії — отже, сервер працює; не перезапускаємо його під сторінкою.
  $KeepRunning = $true
  if ($DesignCraftOnly) { Write-Host 'Запуск із Студії: лише вікно DesignCraft (без Claude Code).' -ForegroundColor Cyan }
  else { Write-Host "Запуск із Студії: $StudioUrl, книга $BookId" -ForegroundColor Cyan }
}

# Скрипт відкрито напряму (не кнопкою зі Студії), без адреси Студії: типове http://localhost:3000 тут не годиться —
# у користувача хмарної Студії такого сервера немає. Беремо адресу, з якої запускали минулого разу, або питаємо.
if ($Portable -and -not $FromLink -and -not $DesignCraftOnly -and -not $PSBoundParameters.ContainsKey('StudioUrl')) {
  $lastStudio = ''
  try {
    $cfgFile = Join-Path (Join-Path $env:LOCALAPPDATA 'DesignCraftStudio') 'config.json'
    if (Test-Path -LiteralPath $cfgFile) { $lastStudio = "$((Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json).lastStudio)" }
  } catch { }
  if (-not (Test-AllowedStudio ($(if ($lastStudio) { $lastStudio } else { 'x' })))) { $lastStudio = '' }
  $defStudio = if ($lastStudio) { $lastStudio } else { $DefaultAllowedStudios[0] }
  Write-Host 'Скрипт запущено напряму. Зазвичай його запускає кнопка «Відкрити графічний редактор DesignCraft» у Студії — вона сама передає адресу Студії, книгу й код підключення.' -ForegroundColor Yellow
  $typed = ''
  if (-not [Console]::IsInputRedirected) { $typed = (Read-Host "Адреса вашої Студії (Enter = $defStudio)").Trim().TrimEnd('/') }
  $StudioUrl = if ($typed) { $typed } else { $defStudio }
  if (-not (Test-AllowedStudio $StudioUrl)) {
    Write-Host "Помилка: адреса Студії «$StudioUrl» не в списку дозволених. Якщо це справді ваша Студія, запустіть скрипт з -AllowedStudio $StudioUrl." -ForegroundColor Red
    Wait-BeforeClose; exit 1
  }
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

# --- Шрифти шаблонів ---------------------------------------------------------------------------------
# Усі шаблони Студії верстають шрифтами DejaVu Serif / DejaVu Sans / DejaVu Sans Mono (вони є на сервері Студії).
# У Windows їх немає, і DesignCraft, відкриваючи чернетку, пропонує «замінити відсутні шрифти» — а це ламає шаблон.
# Тому скрипт один раз (за згодою) ставить DejaVu для вашого користувача Windows: копіює файли в
# %LOCALAPPDATA%\Microsoft\Windows\Fonts і реєструє їх у HKCU (права адміністратора не потрібні). Ліцензія DejaVu вільна.
$DejaVuFonts = [ordered]@{
  'DejaVuSans.ttf'                = 'DejaVu Sans (TrueType)'
  'DejaVuSans-Bold.ttf'           = 'DejaVu Sans Bold (TrueType)'
  'DejaVuSans-Oblique.ttf'        = 'DejaVu Sans Oblique (TrueType)'
  'DejaVuSans-BoldOblique.ttf'    = 'DejaVu Sans Bold Oblique (TrueType)'
  'DejaVuSerif.ttf'               = 'DejaVu Serif (TrueType)'
  'DejaVuSerif-Bold.ttf'          = 'DejaVu Serif Bold (TrueType)'
  'DejaVuSerif-Italic.ttf'        = 'DejaVu Serif Italic (TrueType)'
  'DejaVuSerif-BoldItalic.ttf'    = 'DejaVu Serif Bold Italic (TrueType)'
  'DejaVuSansMono.ttf'            = 'DejaVu Sans Mono (TrueType)'
  'DejaVuSansMono-Bold.ttf'       = 'DejaVu Sans Mono Bold (TrueType)'
  'DejaVuSansMono-Oblique.ttf'    = 'DejaVu Sans Mono Oblique (TrueType)'
  'DejaVuSansMono-BoldOblique.ttf' = 'DejaVu Sans Mono Bold Oblique (TrueType)'
}

# Звідки брати файли шрифтів: поруч зі скриптом (архів зі Студії) або з репозиторію.
function Get-FontsSourceDir {
  $a = Join-Path $PSScriptRoot 'fonts'
  if (Test-Path -LiteralPath $a) { return $a }
  return (Join-Path $PSScriptRoot 'designcraft-fonts')
}

# Які з шрифтів DejaVu є в джерелі, але відсутні в системних і користувацьких теках шрифтів.
function Get-MissingDejaVuFonts([string]$SourceDir, [string[]]$SearchDirs) {
  $missing = @()
  foreach ($file in $DejaVuFonts.Keys) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceDir $file))) { continue }
    $present = $false
    foreach ($d in @($SearchDirs | Where-Object { $_ })) { if (Test-Path -LiteralPath (Join-Path $d $file)) { $present = $true; break } }
    if (-not $present) { $missing += $file }
  }
  return @($missing)
}

# Копіює файли в теку шрифтів користувача й реєструє їх у HKCU (-NoRegister — лише копіювання, для тестів).
function Install-DejaVuFonts([string]$SourceDir, [string]$TargetDir, [string[]]$Files, [switch]$NoRegister) {
  New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
  $regPath = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
  foreach ($file in $Files) {
    $dest = Join-Path $TargetDir $file
    Copy-Item -LiteralPath (Join-Path $SourceDir $file) -Destination $dest -Force
    if (-not $NoRegister) {
      New-ItemProperty -Path $regPath -Name $DejaVuFonts[$file] -Value $dest -PropertyType String -Force | Out-Null
    }
  }
}

# Перевіряє шрифти й за згодою ставить. Викликається до відкриття вікна DesignCraft.
function Confirm-TemplateFonts {
  if ($SkipFonts) { return }
  $src = Get-FontsSourceDir
  if (-not (Test-Path -LiteralPath $src)) { return }
  $userFonts = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
  $missing = Get-MissingDejaVuFonts $src @((Join-Path $env:WINDIR 'Fonts'), $userFonts)
  if ($missing.Count -eq 0) { return }
  $cfg = Read-LauncherConfig
  if ($cfg.fontsDeclined -and -not $InstallFonts) {
    Write-Host 'Шрифти DejaVu не встановлено (ви відмовились раніше): DesignCraft може запропонувати замінити шрифти шаблонів. Дозволити: -InstallFonts.' -ForegroundColor Yellow
    return
  }
  if (-not $InstallFonts) {
    if ([Console]::IsInputRedirected) { return }
    Write-Host ''
    Write-Host "Шаблони Студії верстають шрифтами DejaVu (Serif, Sans, Sans Mono; вільна ліцензія). Їх немає на цьому комп'ютері —" -ForegroundColor Yellow
    Write-Host 'без них DesignCraft пропонує замінити шрифти, і шаблон книги спотворюється.'
    $ans = Read-Host "Встановити $($missing.Count) файлів шрифтів (~5 МБ) для вашого користувача Windows? Права адміністратора не потрібні. (Y/n)"
    if ($ans -match '^[nNнН]') {
      $cfg.fontsDeclined = $true; Write-LauncherConfig $cfg
      Write-Host 'Гаразд. Якщо DesignCraft запропонує замінити шрифти — відмовтесь від заміни або запустіть скрипт з -InstallFonts.'
      return
    }
  }
  try {
    Install-DejaVuFonts $src $userFonts $missing
    $cfg.Remove('fontsDeclined'); Write-LauncherConfig $cfg
    Write-Host "Шрифти DejaVu встановлено ($($missing.Count) файлів): $userFonts" -ForegroundColor Green
    if (Test-ControlPortListening) { Write-Host 'Вікно DesignCraft уже відкрите — закрийте його й запустіть скрипт знову, щоб воно побачило нові шрифти.' -ForegroundColor Yellow }
  } catch {
    Write-Host "Не вдалося встановити шрифти: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Встановіть вручну: відкрийте файли з $src і натисніть «Встановити для всіх/для мене»."
  }
}

# Чи відкрите вікно DesignCraft із портом керування (використовується й шрифтами, і запуском вікна).
function Test-ControlPortListening {
  [bool](Get-NetTCPConnection -LocalPort $ControlPort -State Listen -ErrorAction SilentlyContinue)
}

# --- DesignCraft: де лежить -------------------------------------------------------------------
# Порядок: параметри -> збережене (config.json) -> типові місця -> спитати один раз і запам'ятати.
$ConfigDir = Join-Path $env:LOCALAPPDATA 'DesignCraftStudio'
$ConfigFile = Join-Path $ConfigDir 'config.json'
$DesignCraftReleases = 'https://github.com/storytold/designcraft/releases'

function Find-DesignCraftIn([string]$Dir) {
  if (-not $Dir -or -not (Test-Path -LiteralPath $Dir -PathType Container)) { return $null }
  foreach ($d in @($Dir, (Join-Path $Dir 'bin'), (Join-Path $Dir 'target/release'))) {
    $cli = Join-Path $d 'designcraft-cli.exe'
    $app = Join-Path $d 'designcraft.exe'
    if ((Test-Path -LiteralPath $cli) -or (Test-Path -LiteralPath $app)) { return @{ cli = $cli; app = $app } }
  }
  return $null
}

# --- Автозавантаження DesignCraft зі сторінки релізів проєкту --------------------------------------
# Користувач Студії не має клону репозиторію (D:\Rama\designcraft — це збірка розробника). Тому, коли DesignCraft
# не знайдено, скрипт ПРОПОНУЄ завантажити portable-архів для Windows з офіційних релізів (згода — у вікні, нічого
# не качається мовчки), перевіряє контрольну суму, якщо GitHub її віддає, і розпаковує в %LOCALAPPDATA%\DesignCraftStudio.
$DesignCraftRepo = 'storytold/designcraft'
$DesignCraftDownloadPrefix = "https://github.com/$DesignCraftRepo/releases/download/"

# Обирає з переліку релізів (відповідь GitHub API) архів Windows. Чиста функція: мережі не торкається.
function Select-DesignCraftAsset($Releases, [string]$Version = '') {
  foreach ($r in @($Releases)) {
    if (-not $r -or $r.draft) { continue }
    if ($Version) {
      $want = $Version.TrimStart('v')
      if ("$($r.tag_name)".TrimStart('v') -ne $want) { continue }
    } elseif ($r.prerelease) { continue }
    foreach ($a in @($r.assets)) {
      if ("$($a.name)" -match 'windows-x64-portable\.zip$' -and "$($a.browser_download_url)".StartsWith($DesignCraftDownloadPrefix)) {
        return @{ tag = "$($r.tag_name)"; name = "$($a.name)"; url = "$($a.browser_download_url)"; digest = "$($a.digest)"; size = [long]$a.size }
      }
    }
  }
  return $null
}

# Перевіряє суму (якщо відома), розпаковує архів і знаходить designcraft-cli.exe та designcraft.exe.
# Повертає @{ cli; app } (app може бути $null) або кидає виняток із зрозумілим текстом.
function Expand-DesignCraftZip([string]$ZipPath, [string]$Digest, [string]$DestDir) {
  $hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Digest -match '^sha256:([0-9a-fA-F]{64})$') {
    if ($Matches[1].ToLowerInvariant() -ne $hash) { throw "Контрольна сума архіву не збігається (очікувалась $($Matches[1]), отримано $hash). Файл не розпаковано." }
    Write-Host "Контрольну суму SHA-256 перевірено ($($hash.Substring(0, 12))…)." -ForegroundColor Green
  } else {
    Write-Host "GitHub не віддав контрольну суму цього файла. SHA-256: $hash (порівняйте зі сторінкою релізу, якщо вона її публікує)." -ForegroundColor Yellow
  }
  if (Test-Path -LiteralPath $DestDir) { Remove-Item -LiteralPath $DestDir -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $DestDir -Force
  $cli = Get-ChildItem -LiteralPath $DestDir -Recurse -Filter 'designcraft-cli.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  $app = Get-ChildItem -LiteralPath $DestDir -Recurse -Filter 'designcraft.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cli) { throw 'В архіві немає designcraft-cli.exe — це не той файл, що очікувався.' }
  return @{ cli = $cli.FullName; app = $(if ($app) { $app.FullName } else { $null }) }
}

# Завантажує й розпаковує DesignCraft. Повертає @{ cli; app } або $null (з поясненням у вікні).
function Install-DesignCraftFromGitHub {
  # Без вікна, де можна відповісти, і без -InstallDesignCraft нічого не качаємо.
  if ([Console]::IsInputRedirected -and -not $InstallDesignCraft) { return $null }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Write-Host "Шукаю релізи DesignCraft ($DesignCraftRepo)..." -ForegroundColor Cyan
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$DesignCraftRepo/releases?per_page=20" -Headers @{ 'User-Agent' = 'designcraft-studio-launcher'; Accept = 'application/vnd.github+json' } -TimeoutSec 30
    $asset = Select-DesignCraftAsset $releases $DesignCraftVersion
    if (-not $asset) {
      Write-Host "У релізах немає архіву windows-x64-portable.zip$(if ($DesignCraftVersion) { " для версії $DesignCraftVersion" }). Збірки: $DesignCraftReleases" -ForegroundColor Red
      return $null
    }
    $mb = [math]::Round($asset.size / 1MB, 1)
    Write-Host "Знайдено: $($asset.name) ($($asset.tag), $mb МБ)" -ForegroundColor Cyan
    if (-not $InstallDesignCraft) {
      $ans = Read-Host "Завантажити з офіційних релізів GitHub ($DesignCraftRepo) і розпакувати в $ConfigDir? Без установки, нічого більше не змінюється. (Y/n)"
      if ($ans -match '^[nNнН]') { return $null }
    }
    $zip = Join-Path ([IO.Path]::GetTempPath()) $asset.name
    Write-Host 'Завантажую...'
    # Invoke-WebRequest у Windows PowerShell 5.1 малює індикатор і від того качає в рази повільніше — тому потік вручну.
    $req = [Net.HttpWebRequest]::Create($asset.url)
    $req.UserAgent = 'designcraft-studio-launcher'
    $resp = $req.GetResponse()
    $inStream = $resp.GetResponseStream()
    $outStream = [IO.File]::Create($zip)
    try {
      $buf = New-Object byte[] (1MB)
      $total = [long]$resp.ContentLength; $done = 0L; $nextPct = 10
      while (($n = $inStream.Read($buf, 0, $buf.Length)) -gt 0) {
        $outStream.Write($buf, 0, $n); $done += $n
        if ($total -gt 0) {
          $pct = [int](100 * $done / $total)
          if ($pct -ge $nextPct) { Write-Host "  $pct %"; $nextPct = $pct + 10 }
        }
      }
    } finally { $outStream.Dispose(); $inStream.Dispose(); $resp.Close() }
    $dest = Join-Path $ConfigDir ("designcraft-" + ($asset.tag.TrimStart('v')))
    $pair = Expand-DesignCraftZip $zip $asset.digest $dest
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
    Write-Host "DesignCraft розпаковано: $dest" -ForegroundColor Green
    return $pair
  } catch {
    Write-Host "Не вдалося завантажити DesignCraft: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Завантажте архів вручну: $DesignCraftReleases (windows-x64-portable.zip), розпакуйте й вкажіть папку."
    return $null
  }
}

# designcraft.exe (вікно) може лежати не поряд із designcraft-cli.exe: `cargo install` кладе в .cargo\bin лише CLI.
function Find-DesignCraftAppIn([string]$Dir) {
  if (-not $Dir -or -not (Test-Path -LiteralPath $Dir -PathType Container)) { return $null }
  foreach ($d in @($Dir, (Join-Path $Dir 'bin'), (Join-Path $Dir 'target/release'))) {
    $app = Join-Path $d 'designcraft.exe'
    if (Test-Path -LiteralPath $app) { return $app }
  }
  return $null
}

function Get-DesignCraftSearchDirs {
  $dirs = @($env:DESIGNCRAFT_HOME)
  if (-not $env:DESIGNCRAFT_NO_AUTODETECT) {
    $dirs += (Split-Path -Parent $DesignCraftPath)
    $dirs += 'D:\Rama\designcraft'
    foreach ($pair in @(@($env:LOCALAPPDATA, 'Programs\DesignCraft'), @($env:ProgramFiles, 'DesignCraft'), @($env:USERPROFILE, 'DesignCraft'), @($env:USERPROFILE, '.cargo\bin'))) {
      if ($pair[0]) { $dirs += (Join-Path $pair[0] $pair[1]) }
    }
    $onPath = Get-Command designcraft -ErrorAction SilentlyContinue
    if ($onPath) { $dirs = @($dirs[0], (Split-Path -Parent $onPath.Source)) + @($dirs | Select-Object -Skip 1) }
  }
  return @($dirs | Where-Object { $_ })
}

# Знаходить designcraft.exe; не знайшов — питає папку (Enter = працювати без вікна). Повертає шлях або $null.
function Resolve-DesignCraftApp {
  if ($DesignCraftAppPath -and (Test-Path -LiteralPath $DesignCraftAppPath)) { return $DesignCraftAppPath }
  $cfgApp = $null
  if (Test-Path $ConfigFile) {
    try { $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json; if ($cfg.designcraftAppDir) { $cfgApp = Find-DesignCraftAppIn "$($cfg.designcraftAppDir)" } } catch { }
  }
  if ($cfgApp) { return $cfgApp }
  foreach ($d in (Get-DesignCraftSearchDirs)) {
    $app = Find-DesignCraftAppIn "$d"
    if ($app) { Save-DesignCraftDir (Split-Path -Parent $DesignCraftPath) (Split-Path -Parent $app); return $app }
  }
  if ([Console]::IsInputRedirected -and -not $InstallDesignCraft) { return $null }
  Write-Host ''
  Write-Host "Не знайдено вікно DesignCraft (designcraft.exe). Знайдено лише консольну частину: $DesignCraftPath" -ForegroundColor Yellow
  $pair = Install-DesignCraftFromGitHub
  if ($pair -and $pair.app) {
    Save-DesignCraftDir (Split-Path -Parent $pair.cli) (Split-Path -Parent $pair.app)
    $script:DesignCraftPath = $pair.cli
    return $pair.app
  }
  Write-Host "Збірки проєкту: $DesignCraftReleases"
  for ($try = 1; $try -le 3; $try++) {
    $answer = (Read-Host 'Папка з designcraft.exe (перетягніть сюди; Enter — працювати без вікна)').Trim().Trim('"')
    if (-not $answer) { return $null }
    if (Test-Path -LiteralPath $answer -PathType Leaf) { $answer = Split-Path -Parent $answer }
    $app = Find-DesignCraftAppIn $answer
    if ($app) { Save-DesignCraftDir (Split-Path -Parent $DesignCraftPath) (Split-Path -Parent $app); return $app }
    Write-Host "У «$answer» немає designcraft.exe." -ForegroundColor Red
  }
  return $null
}

function Read-LauncherConfig {
  $cfg = @{}
  if (Test-Path $ConfigFile) {
    try { (Get-Content $ConfigFile -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $cfg[$_.Name] = $_.Value } } catch { }
  }
  return $cfg
}

function Write-LauncherConfig([hashtable]$Cfg) {
  try {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $Cfg | ConvertTo-Json | Set-Content -Path $ConfigFile -Encoding UTF8
  } catch { }
}

function Save-DesignCraftDir([string]$Dir, [string]$AppDir = '') {
  $cfg = Read-LauncherConfig
  $cfg.designcraftDir = $Dir
  if ($AppDir) { $cfg.designcraftAppDir = $AppDir }
  Write-LauncherConfig $cfg
}

function Resolve-DesignCraft {
  if ($DesignCraftPath) {
    return
  }
  $found = $null
  $fromConfig = $false
  if (Test-Path $ConfigFile) {
    try {
      $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json
      if ($cfg.designcraftDir) { $found = Find-DesignCraftIn "$($cfg.designcraftDir)"; $fromConfig = [bool]$found }
    } catch { }
  }
  if (-not $found) {
    # DESIGNCRAFT_HOME завжди враховується; DESIGNCRAFT_NO_AUTODETECT=1 вимикає пошук у PATH і типових папках.
    $candidates = @($env:DESIGNCRAFT_HOME)
    if (-not $env:DESIGNCRAFT_NO_AUTODETECT) {
      $candidates += 'D:\Rama\designcraft'
      foreach ($pair in @(@($env:LOCALAPPDATA, 'Programs\DesignCraft'), @($env:ProgramFiles, 'DesignCraft'), @($env:USERPROFILE, 'DesignCraft'))) {
        if ($pair[0]) { $candidates += (Join-Path $pair[0] $pair[1]) }
      }
      $onPath = Get-Command designcraft-cli -ErrorAction SilentlyContinue
      # PATH — після явного DESIGNCRAFT_HOME (він першим у списку), але перед типовими папками.
      if ($onPath) { $candidates = @($candidates[0], (Split-Path -Parent $onPath.Source)) + @($candidates | Select-Object -Skip 1) }
    }
    foreach ($c in $candidates) { $found = Find-DesignCraftIn "$c"; if ($found) { break } }
    if ($found) { Save-DesignCraftDir (Split-Path -Parent $found.cli) }
  }
  if (-not $found) {
    if ([Console]::IsInputRedirected -and -not $InstallDesignCraft) {
      Fail "Не знайдено DesignCraft. Запустіть скрипт у вікні (він запропонує завантажити DesignCraft), або вкажіть -DesignCraftPath <шлях до designcraft-cli.exe>, або -InstallDesignCraft, або змінну DESIGNCRAFT_HOME. Збірки: $DesignCraftReleases"
    }
    Write-Host ''
    Write-Host 'Не знайдено DesignCraft (designcraft.exe і designcraft-cli.exe).' -ForegroundColor Yellow
    $pair = Install-DesignCraftFromGitHub
    if ($pair) {
      Save-DesignCraftDir (Split-Path -Parent $pair.cli) $(if ($pair.app) { Split-Path -Parent $pair.app } else { '' })
      $script:DesignCraftPath = $pair.cli
      if ($pair.app) { $script:DesignCraftAppPath = $pair.app }
      return
    }
    Write-Host "Або вкажіть папку, де DesignCraft уже є. Збірки проєкту: $DesignCraftReleases"
    for ($try = 1; $try -le 3 -and -not $found; $try++) {
      $answer = (Read-Host 'Вкажіть папку з DesignCraft (можна перетягнути папку або designcraft.exe сюди)').Trim().Trim('"')
      if (-not $answer) { continue }
      if (Test-Path -LiteralPath $answer -PathType Leaf) { $answer = Split-Path -Parent $answer }
      $found = Find-DesignCraftIn $answer
      if (-not $found) { Write-Host "У «$answer» немає designcraft-cli.exe чи designcraft.exe." -ForegroundColor Red }
    }
    if (-not $found) { Fail 'DesignCraft не знайдено. Збережіть його у зручну папку й запустіть скрипт ще раз.' }
    Save-DesignCraftDir (Split-Path -Parent $found.cli)
    Write-Host 'Запам''ятано — наступного разу питати не буду.' -ForegroundColor Green
  }
  $script:DesignCraftPath = $found.cli
  # Вікно шукається окремо (Resolve-DesignCraftApp), коли воно справді потрібне.
}

# --- 0. Попередні перевірки ---------------------------------------------------------------------
if ($ForgetToken) {
  if (Test-Path $TokenFile) { Remove-Item $TokenFile -Force; Write-Host 'Збережений токен видалено.' }
  else { Write-Host 'Збереженого токена немає.' }
  exit 0
}
if (-not $Portable -and -not (Test-Path (Join-Path $RepoRoot 'package.json'))) { Fail "Не знайдено проєкт Студії в $RepoRoot, а поряд зі скриптом немає studio-mcp.mjs — схоже, установка неповна. Розпакуйте архів інсталятора зі Студії (кнопка «Завантажити інсталятор») і запустіть install-designcraft-studio.cmd із розпакованої папки." }
Resolve-DesignCraft
if (-not (Test-Path $DesignCraftPath)) { Fail "Не знайдено DesignCraft: $DesignCraftPath (параметр -DesignCraftPath)." }

# --- Режим «лише DesignCraft» --------------------------------------------------------------------
# Для правки шаблонів і ручної верстки: відкрити вікно DesignCraft і вийти. Без Студії, токена, MCP і Claude Code,
# тож жодного входу чи кредитів не потрібно.
if ($DesignCraftOnly) {
  Confirm-TemplateFonts
  $dcExe = Resolve-DesignCraftApp
  if (-not $dcExe) { Fail "Не знайдено вікно DesignCraft (designcraft.exe). Збірки: $DesignCraftReleases" }
  $running = @(Get-Process -Name 'designcraft' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    Write-Host 'Вікно DesignCraft уже відкрите — перемкніться на нього.' -ForegroundColor Green
  } else {
    Write-Host 'Відкриваю DesignCraft...' -ForegroundColor Cyan
    Start-Process -FilePath $dcExe -WorkingDirectory (Split-Path -Parent $dcExe) | Out-Null
    Write-Host 'DesignCraft запущено. Claude Code не запускався.' -ForegroundColor Green
  }
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}
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

if ($isLocal -and -not $NoStudio -and -not $Portable) {
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
$autoSave = $false
for ($attempt = 1; $attempt -le 3 -and -not $user; $attempt++) {
  if (-not $token -and $PairCode) {
    # Код підключення прийшов із кнопки в Студії — вводити нічого не треба.
    $codeNow = $PairCode; $PairCode = ''
    $script:secureToken = $null
    $token = Invoke-PairCode $codeNow
    $entered = [bool]$token; $autoSave = $entered
    if (-not $token) { continue }
  }
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
if ($Portable) {
  # Наступного разу прямий запуск скрипта не питатиме адресу Студії.
  try { $c = Read-LauncherConfig; $c.lastStudio = $StudioUrl; Write-LauncherConfig $c } catch { }
}

if ($entered) {
  # Підключення за кодом зі Студії запам'ятовуємо без питань (шифрується для вашого Windows; відкликати можна в Студії).
  $save = if ($autoSave) { 'y' } else { Read-Host 'Зберегти токен зашифрованим для вашого Windows-облікового запису? (y/N)' }
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
function Test-DesignCraftServer([string[]]$McpArgs) {
  # Запит іде ФАЙЛОМ через -RedirectStandardInput, а не через потік процесу: .NET у PowerShell 5.1 пише в stdin
  # через StreamWriter із кодуванням консолі (UTF-8 → BOM на початку), і DesignCraft 0.13 відповідає
  # «parse error: expected value at line 1 column 1». Файл — це точні байти без BOM; EOF після рядка закриває сервер.
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("dc-probe-{0}" -f ([guid]::NewGuid().ToString('N')))
  $inFile = "$tmp.in"; $outFile = "$tmp.out"; $errFile = "$tmp.err"
  try {
    $req = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"start-designcraft-studio","version":"1"}}}'
    [IO.File]::WriteAllBytes($inFile, (New-Object System.Text.UTF8Encoding($false)).GetBytes($req + "`n"))
    $p = Start-Process -FilePath $DesignCraftPath -ArgumentList $McpArgs -RedirectStandardInput $inFile `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile -NoNewWindow -PassThru
    $exited = $p.WaitForExit(15000)
    if (-not $exited) { try { $p.Kill() } catch { } }
    $line = ''
    if (Test-Path $outFile) { $line = ((Get-Content -LiteralPath $outFile -Encoding UTF8 -TotalCount 1) -join '').Trim() }
    if (-not $line) {
      $err = ''
      if (Test-Path $errFile) { $err = ((Get-Content -LiteralPath $errFile -Encoding UTF8) -join ' ').Trim() }
      if (-not $exited) { return @{ ok = $false; error = 'DesignCraft не відповів за 15 с.' } }
      return @{ ok = $false; error = "DesignCraft завершився без відповіді. $err".Trim() }
    }
    $resp = $line | ConvertFrom-Json
    if ($resp.error) { return @{ ok = $false; error = "DesignCraft відповів помилкою: $($resp.error.message)" } }
    $info = $resp.result.serverInfo
    return @{ ok = $true; name = "$($info.name)"; version = "$($info.version)" }
  } finally {
    foreach ($f in @($inFile, $outFile, $errFile)) { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
  }
}

Confirm-TemplateFonts

$designcraftArgs = @('mcp')
if ($Headless) {
  Write-Host 'Режим -Headless: DesignCraft без вікна (невидима сесія).' -ForegroundColor Yellow
} else {
  $foundApp = Resolve-DesignCraftApp
  if ($foundApp) {
    $DesignCraftAppPath = $foundApp
  } else {
    # Без вікна агент усе одно верстає, але автор не бачить змін наживо.
    Write-Host 'Вікно DesignCraft не знайдено — працюю без вікна (невидима сесія, як з -Headless).' -ForegroundColor Yellow
    Write-Host "Щоб бачити верстку наживо, поставте designcraft.exe ($DesignCraftReleases) або вкажіть -DesignCraftAppPath."
    $Headless = $true
  }
}
if (-not $Headless) {
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
$workDir = $LogDir
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
# --- API-ключ Claude Code (кредити Anthropic Console) -----------------------------------------------
# Вхід через Console вимагає скопіювати код з браузера й часто падає (400 / «Invalid code»). Для оплати
# з кредитів надійніше API-ключ: вводиться один раз у приховане поле, зберігається зашифрованим для
# вашого користувача Windows (DPAPI, як токен Студії), підставляється ЛИШЕ в процес claude на час запуску.
$ApiKeyFile = Join-Path $ConfigDir 'anthropic-api-key.dat'
$script:UsingApiKey = $false

function Test-ApiKeyShape([string]$Key) {
  return [bool]($Key -and $Key.Trim() -match '^sk-ant-[A-Za-z0-9_\-]{20,}$')
}

function ConvertTo-PlainText([System.Security.SecureString]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-SavedApiKey {
  if (-not (Test-Path -LiteralPath $ApiKeyFile)) { return $null }
  try {
    $plain = ConvertTo-PlainText ((Get-Content -LiteralPath $ApiKeyFile -Raw).Trim() | ConvertTo-SecureString)
    if (Test-ApiKeyShape $plain) { return $plain.Trim() }
  } catch { }
  return $null
}

# Питає ключ у прихованому полі (не показується на екрані, не потрапляє в журнал), зберігає зашифрованим.
function Read-ApiKeyFromUser {
  Write-Host ''
  Write-Host 'Вставте API-ключ з Anthropic Console (console.anthropic.com → API Keys). Він починається з sk-ant-.' -ForegroundColor Cyan
  Write-Host 'Під час введення на екрані нічого не показується — це нормально. Ключ зберігається зашифрованим лише для вашого користувача Windows.'
  for ($i = 0; $i -lt 3; $i++) {
    $plain = (ConvertTo-PlainText (Read-Host 'API-ключ' -AsSecureString)).Trim()
    if (Test-ApiKeyShape $plain) {
      try {
        New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
        ($plain | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString) | Set-Content -Path $ApiKeyFile -Encoding ASCII
        Write-Host "Ключ збережено зашифрованим ($ApiKeyFile). Видалити: -ForgetApiKey." -ForegroundColor Green
      } catch {
        Write-Host 'Не вдалося зберегти ключ; він діятиме лише в цьому запуску.' -ForegroundColor Yellow
      }
      return $plain
    }
    Write-Host 'Це не схоже на ключ Anthropic (очікується sk-ant-… без пробілів). Спробуйте ще раз.' -ForegroundColor Yellow
  }
  Fail 'API-ключ не введено.'
}

if ($ForgetApiKey) {
  if (Test-Path -LiteralPath $ApiKeyFile) { Remove-Item -LiteralPath $ApiKeyFile -Force; Write-Host 'Збережений API-ключ видалено.' -ForegroundColor Green }
  else { Write-Host 'Збереженого API-ключа немає.' }
}

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
  Write-Host '  2. Anthropic Console (API, кредити) — через браузер: треба скопіювати код з браузера в це вікно'
  Write-Host '  3. API-ключ Console (кредити) — без браузера: вставляється один раз, далі запам''ятовується (рекомендовано)'
  $kind = Read-Host 'Номер (Enter = 3)'
  if (-not $kind) { $kind = '3' }
  if ($kind -eq '3') {
    $env:ANTHROPIC_API_KEY = Read-ApiKeyFromUser
    $script:UsingApiKey = $true
    return
  }
  Write-Host 'Відкриваю браузер для входу в Claude Code. Увійдіть у потрібний акаунт і поверніться сюди...' -ForegroundColor Cyan
  if ($kind -eq '2') { & claude auth login --console } else { & claude auth login }
}

# Збережений (або заданий змінною середовища) API-ключ: входити через браузер не потрібно.
if ($Account -ne 'subscription') {
  if ($env:ANTHROPIC_API_KEY) {
    $script:UsingApiKey = $true
    Write-Host 'Claude Code: використовується ANTHROPIC_API_KEY зі змінних середовища (кредити Console), браузер не потрібен.' -ForegroundColor Green
  } else {
    $savedKey = Get-SavedApiKey
    if ($savedKey) {
      $env:ANTHROPIC_API_KEY = $savedKey
      $savedKey = $null
      $script:UsingApiKey = $true
      Write-Host 'Claude Code: використовується збережений API-ключ (кредити Console), браузер не потрібен.' -ForegroundColor Green
    }
  }
}

if (-not $NoLoginCheck -and -not $script:UsingApiKey) {
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
      $st = if ($script:UsingApiKey) { @{ known = $false } } else { Get-ClaudeLoginState }
      if ($st.known -and -not $st.loggedIn) { Fail 'Вхід у Claude Code не виконано. Запустіть скрипт ще раз.' }
    }
  } else {
    Write-Host 'Claude Code: ви не ввійшли.' -ForegroundColor Yellow
    Invoke-ClaudeLogin
    $st = if ($script:UsingApiKey) { @{ known = $false } } else { Get-ClaudeLoginState }
    if ($st.known -and -not $st.loggedIn) { Fail 'Вхід у Claude Code не виконано. Запустіть скрипт ще раз.' }
    Write-Host 'Вхід у Claude Code виконано.' -ForegroundColor Green
  }
}

# --- 6. Конфіг MCP (тимчасовий файл з токеном; видаляється наприкінці) ---------------------------
$workDir = $LogDir
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

$studioMcpScript = Join-Path $RepoRoot 'scripts\studio-mcp.mts'
$studioMcpArgs = if ($Portable) { @((Join-Path $PSScriptRoot 'studio-mcp.mjs')) } else { @('--import', 'tsx', $studioMcpScript) }
$config = @{
  mcpServers = @{
    'nova-studio' = @{
      command = 'node'
      args    = $studioMcpArgs
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
  Set-Location $(if ($Portable) { $workDir } else { $RepoRoot })
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
