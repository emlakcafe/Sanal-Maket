$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)
Set-Location ..

$venv = Join-Path (Get-Location) ".venv-cad"
$python = Join-Path $venv "Scripts\python.exe"
$requirements = Join-Path (Get-Location) "scripts\cad\requirements.txt"

Write-Host "Emlak Cafe CAD motoru hazırlanıyor..."

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "Python bulunamadı. Önce Python 3.11+ kurulmalıdır."
}

if (-not (Test-Path $python)) {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 -m venv $venv
  } else {
    python -m venv $venv
  }
}

& $python -m pip install --upgrade pip
& $python -m pip install -r $requirements

Write-Host ""
Write-Host "CAD motoru hazır:"
Write-Host $python
& $python -c "import ezdxf; print('ezdxf', ezdxf.__version__)"
