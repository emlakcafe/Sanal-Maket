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

  async function locate() {
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
      setMessage("Uydu haritası bölge merkezine getirildi. TKGM parsel geometrisi bağlandığında ada/parsel sınırı otomatik çizilecek.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const satelliteUrl = value.lat && value.lon
    ? `https://www.google.com/maps?q=${value.lat},${value.lon}&z=19&t=k&output=embed`
    : "";

  return (
    <section className="parcelPanel">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">PARSEL / KONUM</span>
          <h3>TKGM + Uydu Hazırlığı</h3>
        </div>
        <span className="integrationBadge">TKGM adaptörü</span>
      </div>

      <div className="parcelGrid">
        <input placeholder="İl" value={value.city} onChange={e => onChange({ ...value, city: e.target.value })} />
        <input placeholder="İlçe" value={value.district} onChange={e => onChange({ ...value, district: e.target.value })} />
        <input placeholder="Mahalle / Köy" value={value.neighborhood} onChange={e => onChange({ ...value, neighborhood: e.target.value })} />
        <input placeholder="Ada" value={value.block} onChange={e => onChange({ ...value, block: e.target.value })} />
        <input placeholder="Parsel" value={value.parcel} onChange={e => onChange({ ...value, parcel: e.target.value })} />
        <button className="secondaryButton" onClick={locate} disabled={loading}>
          {loading ? "Konum aranıyor..." : "Uyduya Getir"}
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
            İl / ilçe / mahalle girip “Uyduya Getir” seçin.
          </div>
        )}
      </div>

      <div className="tkgmNote">
        <strong>TKGM entegrasyon durumu:</strong> Arayüz ve adaptör alanı hazır. Resmî MEGSİS/TKGM servis yetkisi tanımlandığında ada-parsel geometrisi, tapu alanı ve sınır çizimi bu ekrana otomatik bağlanacak.
      </div>
    </section>
  );
}
