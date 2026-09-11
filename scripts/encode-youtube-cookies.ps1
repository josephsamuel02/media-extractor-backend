<#
.SYNOPSIS
  Encode ./cookies.txt to Base64 for YTDLP_COOKIES_B64 (copies to clipboard).
.DESCRIPTION
  Reads the private cookies.txt from the project root, converts its raw bytes
  to Base64, and copies the value to the Windows clipboard. The original file
  is never modified, and the cookie contents are never printed.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\encode-youtube-cookies.ps1
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$cookieFile = Join-Path $root 'cookies.txt'

if (-not (Test-Path -LiteralPath $cookieFile)) {
  Write-Error "cookies.txt not found at $cookieFile. Export your YouTube cookies there first."
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($cookieFile)
if ($bytes.Length -eq 0) {
  Write-Error 'cookies.txt is empty. Nothing to encode.'
  exit 1
}

$base64 = [System.Convert]::ToBase64String($bytes)

try {
  Set-Clipboard -Value $base64
} catch {
  Write-Error 'Could not copy to clipboard. Run this script in Windows Terminal or PowerShell ISE and try again.'
  exit 1
}

Write-Output 'YTDLP_COOKIES_B64 has been copied to your clipboard.'
Write-Output ("Length: {0} characters, {1} source bytes." -f $base64.Length, $bytes.Length)
Write-Output 'Next: paste it as the value of YTDLP_COOKIES_B64 in your local .env and in Render environment variables.'
