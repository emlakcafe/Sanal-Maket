"use client";

import { useMemo, useState } from "react";

export type ParcelForm = {
  city: string;
  district: string;
  neighborhood: string;
  block: string;
  parcel: string;
  lat?: number;
  lon?: number;
  displayName?: string;
};

const TKGM_PARCEL_URL = "https://parselsorgu.tkgm.gov.tr/";

export default function ParcelPanel({
  value,
  onChange
}: {
  value: ParcelForm;
  onChange: (next: ParcelForm) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const localityQuery = useMemo(
    () => [value.neighborhood, value.district, value.city, "Türkiye"].filter(Boolean).join(", "),
    [value.city, value.district, value.neighborhood]
  );

  async function locateParcel() {
    if (!value.city || !value.district || !value.neighborhood || !value.block || !value.parcel) {
      setMessage("İl, ilçe, mahalle/köy, ada ve parsel bilgilerini eksiksiz girin.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({
        city: value.city,
        district: value.district,
        neighborhood: value.neighborhood,
        block: value.block,
        parcel: value.parcel
      });
      const response = await fetch("/api/tkgm/parcel?" + params.toString(), { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "TKGM/MEGSİS parsel sorgusu başarısız.");
      onChange({
        ...value,
        lat: payload.centroid.lat,
        lon: payload.centroid.lon,
        displayName: `${value.city} / ${value.district} / ${value.neighborhood} / Ada ${value.block} / Parsel ${value.parcel}`
      });
      setMessage("Parsel MEGSİS servisinden bulundu. Uydu görünümü gerçek parsel merkezine getirildi.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  async function locateRegion() {
    if (!value.city || !value.district) {
      setMessage("İl ve ilçe girin.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/geocode?q=" + encodeURIComponent(localityQuery));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Konum bulunamadı");
      onChange({ ...value, lat: payload.lat, lon: payload.lon, displayName: payload.displayName });
      setMessage("Uydu görünümü yalnızca bölge merkezine getirildi. Ada/parsel doğrulaması için resmi TKGM Parsel Sorgu düğmesini kullanın.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function openTkgm() {
    if (!value.city || !value.district || !value.neighborhood || !value.block || !value.parcel) {
      setMessage("TKGM sorgusu için il, ilçe, mahalle/köy, ada ve parsel bilgilerini eksiksiz girin.");
      return;
    }
    setMessage(
      `TKGM Parsel Sorgu açılıyor. Resmi ekranda şu bilgileri girin: ${value.city} / ${value.district} / ${value.neighborhood} / Ada ${value.block} / Parsel ${value.parcel}.`
    );
    window.open(TKGM_PARCEL_URL, "_blank", "noopener,noreferrer");
  }

  const satelliteUrl = value.lat && value.lon
    ? `https://www.google.com/maps?q=${value.lat},${value.lon}&z=19&t=k&output=embed`
    : "";

  return (
    <section className="parcelPanel">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">PARSEL / KONUM</span>
          <h3>TKGM + Uydu</h3>
        </div>
        <span className="integrationBadge">Resmi TKGM doğrulaması</span>
      </div>

      <div className="parcelGrid">
        <input placeholder="İl" value={value.city} onChange={e => onChange({ ...value, city: e.target.value })} />
        <input placeholder="İlçe" value={value.district} onChange={e => onChange({ ...value, district: e.target.value })} />
        <input placeholder="Mahalle / Köy" value={value.neighborhood} onChange={e => onChange({ ...value, neighborhood: e.target.value })} />
        <input placeholder="Ada" value={value.block} onChange={e => onChange({ ...value, block: e.target.value })} />
        <input placeholder="Parsel" value={value.parcel} onChange={e => onChange({ ...value, parcel: e.target.value })} />
        <button className="primaryButton" onClick={locateParcel} disabled={loading}>
          {loading ? "Parsel sorgulanıyor..." : "MEGSİS'ten Parseli Getir"}
        </button>
        <button className="secondaryButton" onClick={locateRegion} disabled={loading}>
          {loading ? "Bölge aranıyor..." : "Sadece Bölgeyi Göster"}
        </button>
        <button className="secondaryButton" onClick={openTkgm}>
          TKGM Parsel Sorgu'yu Aç
        </button>
      </div>

      {message && <div className="parcelMessage">{message}</div>}

      <div className="satelliteFrame">
        {satelliteUrl ? (
          <iframe
            title="Uydu görünümü"
            src={satelliteUrl}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="satellitePlaceholder">
            Bölgesel uydu görünümü için il / ilçe / mahalle girin. Kesin ada-parsel konumu için TKGM doğrulamasını kullanın.
          </div>
        )}
      </div>

      <div className="tkgmNote">
        <strong>Entegrasyon:</strong> “MEGSİS'ten Parseli Getir” yetkili TKGM/MEGSİS WFS servisinden gerçek parsel geometrisini sorgular. Servis erişimi yapılandırılmamışsa sistem yaklaşık konum göstermeye çalışmaz; açıkça yetki eksikliğini bildirir.
      </div>
    </section>
  );
}
