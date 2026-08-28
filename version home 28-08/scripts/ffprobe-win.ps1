# Roept ffprobe aan uit dist/ffmpeg-win64-essentials (na download/install, zie README hieronder).
# Gebruik: .\scripts\ffprobe-win.ps1 -ArgumentList '-v','error','-show_streams','pad\naar\video.mp4'
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $ArgumentList
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$essentialsRoot = Join-Path $repoRoot "dist\ffmpeg-win64-essentials"
if (-not (Test-Path $essentialsRoot)) {
  Write-Error "Map ontbreekt: $essentialsRoot`nDownload eerst ffmpeg-release-essentials.zip van https://www.gyan.dev/ffmpeg/builds/ en pak uit naar dist\ffmpeg-win64-essentials\"
}
$ffprobe = Get-ChildItem -LiteralPath $essentialsRoot -Recurse -Filter ffprobe.exe -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $ffprobe) {
  Write-Error "ffprobe.exe niet gevonden onder $essentialsRoot"
}
& $ffprobe.FullName @ArgumentList
