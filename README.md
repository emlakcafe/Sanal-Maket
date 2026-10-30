# Emlak Cafe - Sanal Maket

Kat planı, cephe ve iç mekan renderlarını birleştirerek profesyonel 3B sanal maket üretmek için hazırlanmış hibrit modül.

## İlk sürüm

- Next.js tabanlı proje stüdyosu
- Dosya yükleme ve otomatik sınıflandırma
- Kat planı / cephe / iç mekan ayrımı
- İşlem hattı ilerleme ekranı
- Three.js 3B önizleme
- Çoklu AI motoru bağlamak için adapter katmanı

## Hedef mimari

1. Kat planı motoru -> geometri
2. Görsel referans motoru -> cephe ve iç mekan
3. PBR malzeme motoru
4. Kalite kontrol motoru
5. GLB çıktı
6. Emlak Cafe web entegrasyonu

## Çalıştırma

```bash
npm install
npm run dev
```

Ardından http://localhost:3000 adresini açın.

## Sıradaki entegrasyonlar

- 3d-Floorplans / benzeri plan geometri motoru
- PlanPop tarzı ikinci doğrulama motoru
- TRELLIS / Hunyuan benzeri image-to-3D adaptörü
- Gerçek dosya depolama ve job queue
- GLB model yükleme ve kat bazlı görüntüleme
