$ErrorActionPreference = "Stop"

$demo = "C:\Users\My Pc\Documents\Codex\emlak-cafe-residence-demo"
$target = "C:\Users\My Pc\Sanal-Maket"
$src = Join-Path $demo "src"
$dst = Join-Path $target "components\reference360"
$appDir = Join-Path $target "app"
$publicDir = Join-Path $target "public"

if (-not (Test-Path $demo)) { throw "Referans proje bulunamadi: $demo" }
if (-not (Test-Path $target)) { throw "Sanal-Maket bulunamadi: $target" }

Write-Host "1/7 Referans kaynaklar kopyalaniyor..."
New-Item -ItemType Directory -Force -Path $dst | Out-Null

Get-ChildItem $src -File | Where-Object {
  ($_.Extension -in @(".ts",".tsx")) -and
  ($_.Name -notmatch "\.test\.") -and
  ($_.Name -ne "main.tsx")
} | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $dst $_.Name) -Force
}

Write-Host "2/7 CSS Next.js yapisina uyarlaniyor..."
Get-ChildItem $dst -Filter *.tsx -File | ForEach-Object {
  $text = Get-Content $_.FullName -Raw
  $text = $text -replace "(?m)^import ['""]\./[^'""]+\.css['""];?\r?\n", ""
  Set-Content -Path $_.FullName -Value $text -Encoding UTF8
}

$globalCss = Join-Path $appDir "globals.css"
$markerStart = "/* === REFERENCE360 START === */"
$markerEnd = "/* === REFERENCE360 END === */"
$existing = Get-Content $globalCss -Raw
$existing = [regex]::Replace($existing, "(?s)/\* === REFERENCE360 START === \*/.*?/\* === REFERENCE360 END === \*/", "")

$cssParts = @()
Get-ChildItem $src -Filter *.css -File | ForEach-Object {
  $cssParts += (Get-Content $_.FullName -Raw)
}
$referenceCss = $markerStart + [Environment]::NewLine + ($cssParts -join [Environment]::NewLine) + [Environment]::NewLine + $markerEnd
Set-Content -Path $globalCss -Value ($existing.TrimEnd() + [Environment]::NewLine + $referenceCss + [Environment]::NewLine) -Encoding UTF8

Write-Host "3/7 Next.js sayfalari olusturuluyor..."
$experienceDir = Join-Path $appDir "interaktif-360"
$studioDir = Join-Path $appDir "proje-studyosu-v1"
New-Item -ItemType Directory -Force -Path $experienceDir,$studioDir | Out-Null

@'
"use client";
import Reference360App from "@/components/reference360/App";

export default function Interactive360Page() {
  return <Reference360App localStudio={true} embedded={false} />;
}
'@ | Set-Content -Path (Join-Path $experienceDir "page.tsx") -Encoding UTF8

@'
"use client";
import ProjectStudio from "@/components/reference360/ProjectStudio";

export default function ReferenceProjectStudioPage() {
  return <ProjectStudio storage="local" />;
}
'@ | Set-Content -Path (Join-Path $studioDir "page.tsx") -Encoding UTF8

Write-Host "4/7 Referans varliklar kopyalaniyor..."
$demoPublic = Join-Path $demo "public"
if (Test-Path $demoPublic) {
  New-Item -ItemType Directory -Force -Path $publicDir | Out-Null
  Copy-Item (Join-Path $demoPublic "*") $publicDir -Recurse -Force -ErrorAction SilentlyContinue
}

$transfer = Join-Path $demo "unreal\transfer"
if (Test-Path $transfer) {
  $transferTarget = Join-Path $publicDir "unreal\transfer"
  New-Item -ItemType Directory -Force -Path $transferTarget | Out-Null
  Copy-Item (Join-Path $transfer "*") $transferTarget -Recurse -Force
}

Write-Host "5/7 Three.js surumu referansla eslestiriliyor..."
Push-Location $target
try {
  npm install three@^0.180.0 @types/three@^0.180.0 --save
} finally {
  Pop-Location
}

Write-Host "6/7 Build kontrolu yapiliyor..."
Push-Location $target
try {
  npm run build
} finally {
  Pop-Location
}

Write-Host "7/7 Tamamlandi."
Write-Host ""
Write-Host "Interaktif 360: http://localhost:3000/interaktif-360"
Write-Host "Proje studyosu:  http://localhost:3000/proje-studyosu-v1"
Write-Host ""
Write-Host "Simdi npm run dev ile projeyi baslatin."
