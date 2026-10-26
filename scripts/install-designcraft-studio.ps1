<#
  Встановлення запуску DesignCraft для Студії (один раз).

  Що робить: копіює файли запуску у %LOCALAPPDATA%\DesignCraftStudio і реєструє посилання
  designcraft-studio:// (лише для вашого користувача Windows, без прав адміністратора).
  Після цього кнопка «Відкрити графічний редактор DesignCraft» у Студії запускає DesignCraft на вашому
  комп'ютері. Нічого не завантажує з інтернету; весь вміст — звичайні текстові файли, їх можна прочитати.

  Прибрати: install-designcraft-studio.cmd -Remove (прибирає посилання; файли в папці можна видалити вручну).
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$dest = Join-Path $env:LOCALAPPDATA 'DesignCraftStudio'
$files = @('start-designcraft-studio.ps1', 'start-designcraft-studio.cmd', 'install-designcraft-link.ps1', 'studio-mcp.mjs')

try {
  if ($Remove) {
    $linkScript = Join-Path $dest 'install-designcraft-link.ps1'
    if (Test-Path $linkScript) { & $linkScript -Remove } else { Write-Host 'Посилання не було встановлене.' }
    Write-Host "Файли в $dest можна видалити вручну."
    return
  }

  $missing = @($files | Where-Object { -not (Test-Path (Join-Path $PSScriptRoot $_)) })
  if ($missing.Count -gt 0) {
    throw "Поруч немає файлів: $($missing -join ', '). Спершу розпакуйте архів (правою кнопкою → «Видобути все»), потім запустіть установку з розпакованої папки."
  }

  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($f in $files) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $f) -Destination (Join-Path $dest $f) -Force }
  # Шрифти DejaVu (для шаблонів) — необов'язкові: без них скрипт запуску просто не запропонує їх установити.
  $fontsSrc = Join-Path $PSScriptRoot 'fonts'
  if (Test-Path -LiteralPath $fontsSrc) {
    $fontsDest = Join-Path $dest 'fonts'
    New-Item -ItemType Directory -Force -Path $fontsDest | Out-Null
    Copy-Item -Path (Join-Path $fontsSrc '*') -Destination $fontsDest -Force
  }
  Write-Host "Файли скопійовано в $dest" -ForegroundColor Green

  & (Join-Path $dest 'install-designcraft-link.ps1')

  Write-Host ''
  Write-Host 'Готово. Поверніться в Студію й натисніть «Відкрити графічний редактор DesignCraft».' -ForegroundColor Cyan
  Write-Host 'Браузер спитає дозвіл відкрити програму — погодьтесь. Код підключення візьміть там же, у Студії.'
  Write-Host 'Потрібні також: DesignCraft (designcraft.exe + designcraft-cli.exe) і Claude Code (команда claude).'
  Write-Host 'Папку з DesignCraft скрипт спитає один раз, коли не знайде сам.'
} catch {
  Write-Host ''
  Write-Host "Помилка: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
