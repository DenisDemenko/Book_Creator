# Створює головний ключ шифрування для локального сервера (один раз).
# Ключ — 32 випадкові байти (64 шістнадцяткові символи) у файлі secrets\private_store_master_key; Docker монтує його як секрет.
# Без цього ключа зашифровані дані відновити НЕМОЖЛИВО: збережіть копію окремо (менеджер паролів, сейф).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'secrets'
$file = Join-Path $dir 'private_store_master_key'

if (Test-Path $file) {
    Write-Host "Головний ключ уже є ($file) - не перезаписую."
    exit 0
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
[System.IO.File]::WriteAllText($file, $hex, (New-Object System.Text.UTF8Encoding($false)))

# Windows: файл бачить лише поточний користувач (успадковані права знімаємо).
try {
    $me = "$env:USERDOMAIN\$env:USERNAME"
    & icacls.exe $file /inheritance:r /grant:r "${me}:(R,W)" | Out-Null
} catch {
    Write-Warning 'Не вдалося обмежити права на файл ключа. Зробіть це вручну (лише ваш обліковий запис).'
}

Write-Host ''
Write-Host "Створено головний ключ: $file"
Write-Host 'ВАЖЛИВО: збережіть КОПІЮ цього файлу окремо від комп''ютера (менеджер паролів, сейф).'
Write-Host 'Без нього дані на локальному сервері не відновити - і ніхто, включно зі Studio, не зможе допомогти.'
