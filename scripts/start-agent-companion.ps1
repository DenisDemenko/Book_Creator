param(
  [Parameter(Mandatory=$true)][string]$StudioUrl,
  [Parameter(Mandatory=$true)][string]$RepositoryPath
)
$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 or newer.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows first.' }
$resolvedRepository = (Resolve-Path -LiteralPath $RepositoryPath).Path
$secretToken = Read-Host 'Paste the pairing token from Studio (input is hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretToken)
try {
  $pairingConfig = @{
    server = $StudioUrl
    repositoryPath = $resolvedRepository
    token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
  }
  $pairingConfig | ConvertTo-Json -Compress | & node (Join-Path $PSScriptRoot 'agent-companion.mjs')
  if ($LASTEXITCODE -ne 0) { throw "Companion stopped with exit code $LASTEXITCODE." }
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
  if ($pairingConfig) { $pairingConfig.token = $null }
  $secretToken.Dispose()
}
