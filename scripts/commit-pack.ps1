# Applies a change pack prepared by a cloud session and makes the commits it
# describes. Used while the cloud session cannot push to GitHub itself.
#
#   cd D:\Rama\Book_Creality
#   powershell -ExecutionPolicy Bypass -File scripts\commit-pack.ps1 -Pack tmp\<pack>.tgz [-Push] [-ForceLock]
#
# The pack format is described in PACK-FORMAT.md - that file is the
# instruction for the cloud session that prepares a pack. This script is the
# other half: it applies one and makes the commits the manifest describes.
#
# WHY THIS IS NOT THE SCRIPT IT WAS (rewritten 26.09.2026)
#
# The previous version (kept as tmp/commit-pack.v1.ps1) unpacked `code*.tgz`
# whole and copied `docs*/log.md` over the journal. Both were snapshots of the
# cloud clone, so every file the cloud was behind on came back with them:
# package.json, server.ts, server/db.ts, src/components/EditorView.tsx and
# src/i18n/dictionaries/index.ts returned to their pre-#259 state twice, and a
# pack's journal copy overwrote record #263 written on this machine - after
# which #263 was used by two different records.
#
# The rules are now enforced here instead of trusted:
#   1. `manifest.baseCommit` is a FULL sha. A matching commit subject is not
#      proof of anything, and the old check compared only the subject.
#   2. A pack carries a patch (`git diff <base>..HEAD > pack.patch`), not file
#      tarballs. `extract` still works for a pack that has one, but only the
#      files named in `files` are copied OUT of the archive - never whatever
#      else the tarball happens to hold.
#   3. Journal and plan files (log.md, log/*.md, task.md, PLAN_*.md) are never
#      taken from a pack. The pack carries the text of the record
#      (journal-entry.md); the journal itself is written on this machine with
#      `npm run journal:new`, so the number is the local next number and two
#      sessions cannot take the same one.
#   4. After every write the tree is checked: changed paths must be a subset of
#      the paths the step declares. Anything else stops the run before the
#      commit.
#   5. One writer per working copy: tmp\session.lock is taken for the run and
#      released at the end. Interactive sessions check it too (AGENTS.md).
#
# Manifest (v2):
#   {
#     "title": "...",
#     "baseCommit": "<full 40-char sha>",
#     "allowDirty": ["optional/extra/dirty/paths"],
#     "commits": [
#       { "label": "...",
#         "patch": "0001-code.patch",          # or "extract": "code1.tgz"
#         "files": ["src/...", "server/..."],       # every path this commit writes
#         "message": "msg1.txt",
#         "tests": ["test:visual-review"],
#         "fill": ["server/core/x.ts"] }        # @@C1@@ placeholders
#     ]
#   }
#   Patches must be plain `git diff` output: they are applied with
#   `git apply --3way`, so tests run BEFORE the commit. A `git format-patch`
#   mailbox is accepted, but `git am` commits it itself and the tests then run
#   after the commit - prefer the plain diff.
#
# Nothing is deleted: the unpacked pack stays in tmp\pack-<name> for
# inspection. Delete it (or archive it outside the repository) after the run -
# a leftover copy of the journal in tmp/ is how the file above got clobbered.

param(
  [Parameter(Mandatory = $true)][string]$Pack,
  [switch]$Push,
  [switch]$ForceLock
)

$ErrorActionPreference = 'Stop'
# The script lives in scripts/ of the repository, so the root is taken from its
# own location instead of a hard-coded path: a second copy of the repository
# (a git worktree, for instance) must work the same way.
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$utf8 = New-Object System.Text.UTF8Encoding $false
$lockPath = Join-Path $repo 'tmp\session.lock'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host ''; Write-Host "STOP: $text" -ForegroundColor Red; exit 1 }
function Invoke-Git([string[]]$argv) {
  & git.exe @argv
  if ($LASTEXITCODE -ne 0) { Fail "git $($argv -join ' ') (code $LASTEXITCODE)" }
}
function Run([string]$what) {
  & cmd /c $what
  if ($LASTEXITCODE -ne 0) { Fail "$what (code $LASTEXITCODE)" }
}
function RepoPath([string]$rel) { return (Join-Path $repo $rel.Replace('/', '\')) }

# Journal and plan files belong to the machine that runs the pack, not to the
# pack. Names, not a glob of the whole repository: `PLAN_*.md` and `task.md`
# are the plan, `log/` is the journal, and everything else is code.
function Test-MachineWritten([string]$rel) {
  $r = $rel.Replace('\', '/')
  if ($r -eq 'log.md' -or $r -eq 'task.md') { return $true }
  if ($r -like 'log/*.md') { return $true }
  if ($r -like 'PLAN_*.md') { return $true }
  return $false
}

# Changed paths that this step did not declare. Journal files are tolerated
# here and reported instead of failing - a pack may no longer touch them, so
# they are not at risk, and a pending record must not block a pack run.
function Assert-TreeMatches([string[]]$declared, [string[]]$allowExtra) {
  $rows = @(& git.exe -c core.quotepath=false status --porcelain --untracked-files=no)
  $unexpected = @()
  $journalDirty = @()
  foreach ($row in $rows) {
    $path = $row.Substring(3).Trim('"')
    if ($path -like '* -> *') { $path = $path.Split('->', 2)[1].Trim('"') }
    if ($path -eq '.vscode/settings.json') { continue }
    if ($path -like '*desktop.ini') { continue }
    if ($declared -contains $path -or $allowExtra -contains $path) { continue }
    if (Test-MachineWritten $path) { $journalDirty += $path; continue }
    $unexpected += $path
  }
  if ($journalDirty.Count -gt 0) {
    Warn 'uncommitted journal/plan changes in the tree (this pack does not touch them):'
    foreach ($j in $journalDirty) { Warn "  $j" }
    Warn 'check them after the run: git diff --stat -- log.md log/ task.md PLAN_*.md'
  }
  if ($unexpected.Count -gt 0) {
    Write-Host ''
    Write-Host 'Paths changed that this step must not touch:' -ForegroundColor Yellow
    foreach ($u in $unexpected) { Write-Host "  $u" }
    Write-Host 'If these are old copies from another session, restore them:  git checkout HEAD -- <paths>' -ForegroundColor Yellow
    Fail 'working tree holds changes this pack does not declare - nothing committed'
  }
}

$packPath = Join-Path $repo $Pack
if (-not (Test-Path -LiteralPath $packPath)) { Fail "$Pack not found" }

if (Test-Path -LiteralPath $lockPath) {
  $existing = [System.IO.File]::ReadAllText($lockPath, $utf8)
  if (-not $ForceLock) {
    Fail "the working copy is already taken (tmp\session.lock):`n$existing`nWait for that run to finish, or pass -ForceLock if it is surely dead."
  }
  Warn 'lock overridden by -ForceLock'
}
$session = 'pack-runner'
if ($env:COPILOT_AGENT_SESSION) { $session = $env:COPILOT_AGENT_SESSION }
elseif ($env:CLAUDE_SESSION_ID) { $session = $env:CLAUDE_SESSION_ID }
$lock = @{
  session   = $session
  pack      = $Pack
  startedAt = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  pid       = $PID
} | ConvertTo-Json
[System.IO.File]::WriteAllText($lockPath, $lock, $utf8)

try {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($packPath)
  $dir = Join-Path $repo "tmp\pack-$name"
  # Fresh extraction: a leftover directory from an earlier run would also be a
  # leftover copy of everything that run carried.
  if (Test-Path -LiteralPath $dir) { Remove-Item -Recurse -Force -LiteralPath $dir }
  New-Item -ItemType Directory -Force $dir | Out-Null
  & tar -xzf $packPath -C $dir
  if ($LASTEXITCODE -ne 0) { Fail "cannot unpack $Pack" }
  $manifest = [System.IO.File]::ReadAllText((Join-Path $dir 'manifest.json'), $utf8) | ConvertFrom-Json

  Step "Pack: $($manifest.title)"
  if (-not $manifest.baseCommit) { Fail 'manifest.json has no baseCommit (full sha) - tell the cloud session to rebuild the pack' }
  $headFull = (& git.exe rev-parse HEAD).Trim()
  Write-Host "HEAD: $headFull"
  if ($manifest.baseCommit -ne $headFull) {
    Fail "pack is built on $($manifest.baseCommit), this tree is on $headFull - nothing done"
  }

  & git.exe diff --cached --quiet
  if ($LASTEXITCODE -ne 0) { Fail 'something is already staged (git add) - nothing done, tell the cloud session' }

  $allowDirty = @()
  if ($manifest.allowDirty) { $allowDirty = @($manifest.allowDirty) }
  # Before anything is written: code files dirty from another session stop the
  # run, because the pack would build its commits on top of someone else's work.
  Assert-TreeMatches @() $allowDirty

  Step 'Journal files in the pack'
  $journalInPack = @()
  foreach ($c in $manifest.commits) {
    $all = @()
    if ($c.files) { $all += @($c.files) }
    if ($c.copy) { $all += @($c.copy) }
    if ($c.fill) { $all += @($c.fill) }
    foreach ($f in $all) { if (Test-MachineWritten $f) { $journalInPack += "$f ($($c.label))" } }
  }
  if ($journalInPack.Count -gt 0) {
    foreach ($j in $journalInPack) { Write-Host "  $j" -ForegroundColor Yellow }
    Fail 'the pack carries journal or plan files - not allowed (AGENTS.md, "Parallel sessions and packs"). The pack ships the text of the record (journal-entry.md); the journal is written on this machine with npm run journal:new'
  }
  if (Test-Path -LiteralPath (Join-Path $dir 'journal-entry.md')) {
    Write-Host '  the text of the journal record is in the pack: ' -NoNewline
    Write-Host (Join-Path $dir 'journal-entry.md') -ForegroundColor Green
    Write-Host '  after the commits: npm run journal:new, then paste this text in and commit it separately'
  }

  $hashes = @{}
  $i = 0
  foreach ($c in $manifest.commits) {
    $i++
    Step "Commit $i of $($manifest.commits.Count): $($c.label)"
    $files = @()
    if ($c.files) { $files = @($c.files) }
    if ($files.Count -eq 0) { Fail "commit $i declares no files" }

    $committedByGit = $false
    if ($c.patch) {
      $patchFile = Join-Path $dir $c.patch
      if (-not (Test-Path -LiteralPath $patchFile)) { Fail "cannot find $($c.patch)" }
      $firstLine = (Get-Content -LiteralPath $patchFile -TotalCount 1)
      if ($firstLine -like 'From *') {
        Warn 'this is a mailbox (git format-patch): git am commits it itself, so the tests run after the commit'
        Invoke-Git @('am', '--3way', $patchFile)
        $committedByGit = $true
      } else {
        Invoke-Git @('apply', '--3way', '--whitespace=nowarn', $patchFile)
      }
    }
    if ($c.extract) {
      $ex = Join-Path $dir "extract-$i"
      New-Item -ItemType Directory -Force $ex | Out-Null
      & tar -xzf (Join-Path $dir $c.extract) -C $ex
      if ($LASTEXITCODE -ne 0) { Fail "cannot unpack $($c.extract)" }
      foreach ($f in $files) {
        $src = Join-Path $ex $f.Replace('/', '\')
        if (-not (Test-Path -LiteralPath $src)) { Fail "file '$f' is declared by the pack but absent from $($c.extract)" }
        $dst = RepoPath $f
        New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
        Copy-Item -Force -LiteralPath $src -Destination $dst
      }
    }
    if ($c.fill) {
      foreach ($f in @($c.fill)) {
        $p = RepoPath $f
        $t = [System.IO.File]::ReadAllText($p, $utf8)
        foreach ($k in $hashes.Keys) { $t = $t.Replace("@@C$k@@", $hashes[$k]) }
        [System.IO.File]::WriteAllText($p, $t, $utf8)
      }
    }

    # The guard that would have caught 26.09.2026: whatever the pack wrote must
    # be exactly what it declared.
    Assert-TreeMatches $files $allowDirty

    if ($c.tests) {
      foreach ($test in @($c.tests)) {
        Step "npm run $test"
        Run "npm run $test"
      }
    }

    if ($committedByGit) {
      $hashes["$i"] = (& git.exe rev-parse --short HEAD).Trim()
      continue
    }
    Invoke-Git (@('add', '--') + $files)
    Invoke-Git @('commit', '-F', (Join-Path $dir $c.message))
    $hashes["$i"] = (& git.exe rev-parse --short HEAD).Trim()
  }

  Step 'Journal check'
  Run 'npm run journal:check'

  Step 'Commits'
  & git.exe log --oneline -n "$($manifest.commits.Count + 1)"

  if ($Push) {
    Step 'Push: origin'
    Invoke-Git @('push', 'origin', 'master')
    Step 'Push: production'
    Invoke-Git @('push', 'production', 'master')
    $pushed = 'and pushed'
  } else {
    $pushed = '(not pushed: git push origin master; git push production master)'
  }

  Step 'Done'
  & git.exe status --short
  Write-Host ''
  Write-Host "All $($manifest.commits.Count) commits are made $pushed." -ForegroundColor Green
  Write-Host 'Next: (1) npm run journal:new plus the text from the pack (journal-entry.md), commit the journal separately;' -ForegroundColor Green
  Write-Host '      (2) remove the unpacked tmp\pack-<name> - a copy of the journal left in tmp/ is exactly what clobbered the real one.' -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $lockPath) { Remove-Item -Force -LiteralPath $lockPath }
}
