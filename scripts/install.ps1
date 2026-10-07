<#
.SYNOPSIS
  helix installer — native Windows (PowerShell 5.1+ / 7+).

.DESCRIPTION
  Installs the toolchain (Git, Node 22 LTS), clones sm-me-dev/helix,
  copies .env.example to .env, runs npm ci, optionally installs
  Playwright Chromium, then typechecks.

  No admin rights required unless a toolchain install needs them.
  Everything else happens in user space (default: $HOME\helix).

.EXAMPLE
  # Inspect first (recommended), then run:
  #   notepad $env:TEMP\Install-Helix.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File Install-Helix.ps1

.EXAMPLE
  powershell -File Install-Helix.ps1 -Dir "$HOME\code\helix" -Ref main -Yes

.LINK
  https://github.com/sm-me-dev/helix/blob/main/docs/INSTALL.md
#>
[CmdletBinding()]
param(
  [string]$Dir = $(if ($env:HELIX_DIR) { $env:HELIX_DIR } else { Join-Path $HOME 'helix' }),
  [string]$Ref = $(if ($env:HELIX_REF) { $env:HELIX_REF } else { 'main' }),
  [switch]$Yes,
  [switch]$DryRun,
  [switch]$SkipNode,
  [switch]$SkipDeps,
  [switch]$SkipPlaywright,
  [switch]$NoVerify,
  [switch]$Version
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Script:Version = '1.0.0'
$RepoUrl = 'https://github.com/sm-me-dev/helix.git'
$MinNodeMajor = 20
$PreferredNodeMajor = 22

function Write-Info($msg) { Write-Host "[helix] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[helix] $msg" -ForegroundColor Green }
function Write-WarnMsg($msg) { Write-Warning "[helix] $msg" }

function Invoke-Step {
  param([string]$Label, [scriptblock]$Action)
  if ($DryRun) { Write-Host "[dry-run] $Label"; return }
  Write-Info $Label
  & $Action
}

function Test-Cmd($name) { $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Get-NodeMajor {
  try { [int]((node -p "process.versions.node.split('.')[0]" 2>$null)) }
  catch { 0 }
}

if ($Version) { Write-Output "helix-install $($Script:Version)"; exit 0 }

Write-Info "helix installer v$($Script:Version) — dir=$Dir ref=$Ref"

# ----- toolchain -----
if (-not $SkipNode) {
  if (Test-Cmd 'node') {
    $major = Get-NodeMajor
    if ($major -ge $MinNodeMajor) {
      if ($major -ne $PreferredNodeMajor) {
        Write-WarnMsg "Node v$major detected — works (>=$MinNodeMajor), recommended: v$PreferredNodeMajor LTS."
      } else {
        Write-Ok "Node $(node --version) detected."
      }
    } else {
      Write-WarnMsg "Node v$major too old (need >= $MinNodeMajor). Install Node $PreferredNodeMajor LTS and re-run, or use -SkipNode."
    }
  } else {
    Write-Info "Node not found. Install it, then re-run:"
    Write-Host '  winget install OpenJS.NodeJS.LTS' -ForegroundColor Yellow
    Write-Host '  # or: choco install nodejs-lts --version=22.0.0' -ForegroundColor Yellow
    if (-not $Yes) { throw 'Node.js is required. Install it and re-run (or pass -SkipNode to proceed anyway).' }
  }
  if (-not (Test-Cmd 'npm')) { throw 'npm was not found. Install Node 22 LTS first.' }
  if (-not (Test-Cmd 'git')) { throw 'git was not found. Install it: winget install Git.Git' }
} else {
  Write-Info '-SkipNode: leaving the toolchain alone.'
}

# ----- repo -----
if (Test-Path (Join-Path $Dir '.git')) {
  Write-Info "Existing checkout at $Dir — updating to '$Ref'."
  Invoke-Step "git fetch + checkout $Ref" {
    git -C $Dir fetch origin --prune
    git -C $Dir checkout $Ref
    git -C $Dir pull --ff-only origin $Ref
  }
} else {
  if ((Test-Path $Dir) -and -not $Yes) {
    throw "$Dir exists but is not a git checkout. Use -Dir to pick another path (or -Yes to abort safely)."
  }
  if (-not (Test-Path $Dir)) {
    if (-not ($Yes -or $DryRun)) {
      $answer = Read-Host "Clone helix into $Dir? [y/N]"
      if ($answer -notmatch '^[Yy]([Ee][Ss])?$') { throw 'Aborted by user.' }
    }
    Invoke-Step "git clone --branch $Ref" {
      git clone --branch $Ref --depth 1 $RepoUrl $Dir
    }
  }
}

# ----- .env (never overwrite) -----
$envFile = Join-Path $Dir '.env'
$envExample = Join-Path $Dir '.env.example'
if (Test-Path $envFile) {
  Write-Info '.env already exists — leaving it untouched.'
} elseif (Test-Path $envExample) {
  Invoke-Step 'Copy .env.example to .env' { Copy-Item $envExample $envFile }
} else {
  Write-WarnMsg 'No .env.example found — skipping .env creation.'
}

# ----- deps -----
if (-not $SkipDeps) {
  Invoke-Step 'npm ci (fallback: npm install)' {
    Push-Location $Dir
    try {
      npm ci --no-audit --no-fund
    } catch {
      Write-WarnMsg 'npm ci failed (usually lockfile drift) — trying npm install.'
      npm install --no-audit --no-fund
    } finally {
      Pop-Location
    }
  }
} else {
  Write-Info '-SkipDeps: skipping npm install.'
}

# ----- playwright -----
$pkgJson = Join-Path $Dir 'package.json'
if ((-not $SkipPlaywright) -and (-not $SkipDeps) -and (Test-Path $pkgJson) `
    -and (Select-String -Path $pkgJson -Pattern '"playwright"' -Quiet)) {
  Invoke-Step 'npx playwright install chromium' {
    Push-Location $Dir
    try { npx playwright install chromium } finally { Pop-Location }
  }
}

# ----- verify -----
if ((-not $NoVerify) -and (-not $SkipDeps)) {
  Invoke-Step 'npm run typecheck' {
    Push-Location $Dir
    try { npm run typecheck } finally { Pop-Location }
  }
} else {
  Write-Info 'Verification skipped (-NoVerify or -SkipDeps).'
}

Write-Ok 'Done. Next steps:'
Write-Host "  cd $Dir"
Write-Host '  npm run dev      # http://localhost:8080'
Write-Host 'Full guide: docs/INSTALL.md'
