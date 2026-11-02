param(
  [Parameter(Mandatory=$true)][string]$InputGlb,
  [string]$OutputPng = ""
)

$Blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$Script = Join-Path $PSScriptRoot "render_glb.py"

if (!(Test-Path $Blender)) {
  throw "Blender bulunamadi: $Blender"
}
if (!(Test-Path $InputGlb)) {
  throw "GLB bulunamadi: $InputGlb"
}
if ([string]::IsNullOrWhiteSpace($OutputPng)) {
  $dir = Split-Path $InputGlb -Parent
  $name = [System.IO.Path]::GetFileNameWithoutExtension($InputGlb)
  $OutputPng = Join-Path $dir ($name + "-render.png")
}

& $Blender -b -P $Script -- $InputGlb $OutputPng

if ($LASTEXITCODE -ne 0) {
  throw "Blender render basarisiz. Cikis kodu: $LASTEXITCODE"
}

Write-Host ""
Write-Host "Render hazir:" -ForegroundColor Green
Write-Host $OutputPng -ForegroundColor Cyan
