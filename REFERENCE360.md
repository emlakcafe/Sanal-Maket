# Reference 360 v1

Bu kurulum betiği, yerel Codex referans projesindeki çalışan interaktif 360 mimarisini Sanal-Maket'e taşır.

## Kaynak
`C:\Users\My Pc\Documents\Codex\emlak-cafe-residence-demo`

## Kurulum
```powershell
cd "C:\Users\My Pc\Sanal-Maket"
powershell -ExecutionPolicy Bypass -File .\scripts\install-reference360.ps1
npm run dev
```

## Sayfalar
- `/interaktif-360` — Codex referansındaki çok modlu proje deneyimi
- `/proje-studyosu-v1` — görsel/panorama yükleme ve önizleme stüdyosu

Betik kaynak bileşenleri, CSS'i ve mevcut public/unreal varlıklarını otomatik kopyalar; Three.js sürümünü referans projeyle eşitler ve build kontrolü yapar.
