<#
  Реєструє посилання designcraft-studio:// для кнопки «Відкрити графічний редактор DesignCraft»
  на сторінці «Верстка для публікації».

  Що робить: записує в HKEY_CURRENT_USER\Software\Classes\designcraft-studio обробник, який
  запускає scripts\start-designcraft-studio.ps1 -Url "<посилання>". Лише для вашого користувача
  Windows, без прав адміністратора. Нічого не завантажує й не встановлює.

  Безпека: посилання може відкрити будь-яка сторінка, але скрипт запуску приймає адресу Студії
  лише зі списку дозволених і питає вхід. Браузер теж питає дозвіл перед кожним запуском.

  Запуск:   scripts\install-designcraft-link.cmd
  Прибрати: scripts\install-designcraft-link.cmd -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$key = 'HKCU:\Software\Classes\designcraft-studio'

if ($Remove) {
  if (Test-Path $key) { Remove-Item $key -Recurse -Force; Write-Host 'Посилання designcraft-studio:// прибрано.' -ForegroundColor Green }
  else { Write-Host 'Посилання designcraft-studio:// не було встановлене.' }
  exit 0
}

$script = Join-Path $PSScriptRoot 'start-designcraft-studio.ps1'
if (-not (Test-Path $script)) { Write-Host "Не знайдено $script" -ForegroundColor Red; exit 1 }
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
# -File + "%1": посилання передається одним аргументом, символи & у ньому не ламають командний рядок.
$command = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$script`" -Url `"%1`""

New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name '(default)' -Value 'URL:DesignCraft Studio'
Set-ItemProperty -Path $key -Name 'URL Protocol' -Value ''
New-Item -Path "$key\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "$key\shell\open\command" -Name '(default)' -Value $command

Write-Host 'Посилання designcraft-studio:// встановлено.' -ForegroundColor Green
Write-Host "Обробник: $command"
Write-Host 'Тепер кнопка «Відкрити графічний редактор DesignCraft» у Студії запускатиме скрипт. Прибрати: -Remove.'
