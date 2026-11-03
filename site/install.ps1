# scripts/install.ps1 — Universal PowerShell installer for Helix on Windows
# Usage:
#   irm https://sm-me-dev.github.io/helix/install.ps1 | iex
# Or with options:
#   .\install.ps1 -Version "0.1.0"

[CmdletBinding()]
param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\helix"
)

$ErrorActionPreference = "Stop"
$Repo = "sm-me-dev/helix"

Write-Host "==> Helix Windows Installer" -ForegroundColor Cyan

# Check Architecture
$Arch = $env:PROCESSOR_ARCHITECTURE
if ($Arch -ne "AMD64" -and $Arch -ne "ARM64") {
    Write-Error "Unsupported architecture: $Arch. Helix requires 64-bit Windows (x64)."
    exit 1
}

# Determine Release Tag
if ($Version -eq "latest") {
    Write-Host "==> Fetching latest release tag from GitHub..." -ForegroundColor Cyan
    try {
        $Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
        $Tag = $Release.tag_name
    } catch {
        Write-Warning "Could not query GitHub releases API; defaulting to v0.1.0"
        $Tag = "v0.1.0"
    }
} else {
    if ($Version.StartsWith("v")) { $Tag = $Version } else { $Tag = "v$Version" }
}

$Ver = $Tag.TrimStart("v")
$Asset = "helix-v$Ver-windows-x64.zip"
$DownloadUrl = "https://github.com/$Repo/releases/download/$Tag/$Asset"
$SumsUrl = "https://github.com/$Repo/releases/download/$Tag/SHA256SUMS.txt"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    $ZipPath = Join-Path $TempDir $Asset
    Write-Host "==> Downloading $Asset..." -ForegroundColor Cyan
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

    # Verify Checksum
    $SumsPath = Join-Path $TempDir "SHA256SUMS.txt"
    try {
        Invoke-WebRequest -Uri $SumsUrl -OutFile $SumsPath -UseBasicParsing
        if (Test-Path $SumsPath) {
            $Expected = Get-Content $SumsPath | Where-Object { $_ -match $Asset } | ForEach-Object { ($_ -split "\s+")[0] }
            if ($Expected) {
                $Actual = (Get-FileHash -Path $ZipPath -Algorithm SHA256).Hash.ToLower()
                if ($Actual -ne $Expected.ToLower()) {
                    Write-Error "Checksum mismatch! Expected: $Expected, Actual: $Actual"
                    exit 1
                }
                Write-Host "==> Checksum verified: $Actual" -ForegroundColor Green
            }
        }
    } catch {
        Write-Warning "Could not verify SHA-256 digest; continuing with downloaded archive."
    }

    # Extract
    Write-Host "==> Extracting to $InstallDir..." -ForegroundColor Cyan
    if (Test-Path $InstallDir) {
        Remove-Item -Path $InstallDir -Recurse -Force
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Expand-Archive -Path $ZipPath -DestinationPath $TempDir -Force

    $ExtractedRoot = Join-Path $TempDir "helix"
    Copy-Item -Path (Join-Path $ExtractedRoot "*") -Destination $InstallDir -Recurse -Force

    # PATH Configuration
    $BinPath = Join-Path $InstallDir "bin"
    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($UserPath -notlike "*$BinPath*") {
        Write-Host "==> Adding $BinPath to User PATH..." -ForegroundColor Cyan
        [Environment]::SetEnvironmentVariable("Path", "$UserPath;$BinPath", "User")
        $env:PATH = "$env:PATH;$BinPath"
    }

    # Verify
    $HelixCmd = Join-Path $BinPath "helix.cmd"
    if (Test-Path $HelixCmd) {
        Write-Host "==> Verifying installation..." -ForegroundColor Cyan
        & $HelixCmd --version
        Write-Host "==> Helix $Tag installed successfully!" -ForegroundColor Green
        Write-Host "Run 'helix --help' to get started." -ForegroundColor Green
    } else {
        Write-Error "Installed binary not found at $HelixCmd"
        exit 1
    }
} finally {
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
