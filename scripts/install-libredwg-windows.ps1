$ErrorActionPreference = "Stop"

$download = "https://github.com/LibreDWG/libredwg/releases/download/0.14/libredwg-0.14-win64.zip"
$expectedSha256 = "1ad7e15344d20b3426c3435b078d82fb84b35062815946b2cca9c5fc9810fea8"

$target = Join-Path $env:LOCALAPPDATA "libredwg"
$zip = Join-Path $env:TEMP "libredwg-0.14-win64.zip"

Write-Host "LibreDWG 0.14 indiriliyor..."
Invoke-WebRequest -Uri $download -OutFile $zip -UseBasicParsing

$actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
if ($actual -ne $expectedSha256) {
  Remove-Item $zip -Force -ErrorAction SilentlyContinue
  throw "SHA256 dogrulamasi basarisiz. Indirme iptal edildi."
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Expand-Archive -Path $zip -DestinationPath $target -Force
Remove-Item $zip -Force -ErrorAction SilentlyContinue

$exe = Join-Path $target "dwg2dxf.exe"
if (-not (Test-Path $exe)) {
  $found = Get-ChildItem -Path $target -Filter "dwg2dxf.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) {
    Copy-Item $found.FullName $exe -Force
  }
}

if (-not (Test-Path $exe)) {
  throw "dwg2dxf.exe arsivden cikartilamadi."
}

Write-Host "Kurulum tamamlandi:"
Write-Host $exe
& $exe --version
