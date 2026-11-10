# Fetch official tools on Windows when building DevGitBrowser.
# Video processing happens only on user PCs, never on the VPS.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dest = Join-Path $root 'vendor/video'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
$ytUrl = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe'
$ytSha = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'
$yt = Join-Path $dest 'yt-dlp.exe'
Invoke-WebRequest -Uri $ytUrl -OutFile $yt
$got = (Get-FileHash -Path $yt -Algorithm SHA256).Hash.ToLowerInvariant()
if ($got -ne $ytSha) { throw "Empreinte yt-dlp invalide : $got" }
$ffUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
$work = Join-Path $env:TEMP ("dgb-video-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  $zip = Join-Path $work 'ffmpeg.zip'
  Invoke-WebRequest -Uri $ffUrl -OutFile $zip
  $hashResponse = (Invoke-WebRequest -Uri ($ffUrl + '.sha256')).Content
  if ($hashResponse -is [byte[]]) { $hashResponse = [Text.Encoding]::UTF8.GetString($hashResponse) }
  $expected = [regex]::Match([string]$hashResponse, '(?i)\b[a-f0-9]{64}\b').Value.ToLowerInvariant()
  if ($expected.Length -ne 64) { throw 'Empreinte SHA-256 FFmpeg manquante.' }
  $actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "Empreinte FFmpeg invalide : $actual" }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $work 'extracted') -Force
  foreach ($name in @('ffmpeg.exe','ffprobe.exe')) {
    $file = Get-ChildItem -Path (Join-Path $work 'extracted') -Recurse -Filter $name -File | Select-Object -First 1
    if (!$file) { throw "Binaire manquant : $name" }
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $dest $name) -Force
  }
} finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host 'Moteur vidéo Windows local intégré.'
