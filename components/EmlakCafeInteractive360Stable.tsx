"use client";

import { useMemo, useState } from "react";

type Status = "available" | "reserved" | "sold";
type Mode = "project" | "units" | "tour" | "gallery" | "location";

type Unit = {
  id: string;
  block: string;
  floor: number;
  type: string;
  area: number;
  facade: string;
  status: Status;
};

const units: Unit[] = [
  { id: "A-01", block: "A", floor: 1, type: "2+1", area: 112, facade: "Güney", status: "available" },
  { id: "A-02", block: "A", floor: 1, type: "3+1", area: 148, facade: "Batı", status: "reserved" },
  { id: "A-11", block: "A", floor: 2, type: "2+1", area: 112, facade: "Güney", status: "available" },
  { id: "B-01", block: "B", floor: 1, type: "1+1", area: 76, facade: "Doğu", status: "sold" },
  { id: "B-12", block: "B", floor: 2, type: "3+1", area: 154, facade: "Kuzey", status: "available" },
  { id: "C-21", block: "C", floor: 3, type: "4+1", area: 196, facade: "Güney", status: "available" }
];

const statusText: Record<Status,string> = {
  available: "Müsait",
  reserved: "Rezerve",
  sold: "Satıldı"
};

export default function EmlakCafeInteractive360() {
  const [mode, setMode] = useState<Mode>("project");
  const [block, setBlock] = useState("Tümü");
  const [floor, setFloor] = useState("Tümü");
  const [type, setType] = useState("Tümü");
  const [status, setStatus] = useState("Tümü");
  const [selected, setSelected] = useState<Unit | null>(null);

  const filtered = useMemo(() => {
    return units.filter((u) => {
      if (block !== "Tümü" && u.block !== block) return false;
      if (floor !== "Tümü" && String(u.floor) !== floor) return false;
      if (type !== "Tümü" && u.type !== type) return false;
      if (status !== "Tümü" && u.status !== status) return false;
      return true;
    });
  }, [block, floor, type, status]);

  return (
    <main style={{ minHeight: "100vh", background: "#07111e", color: "#eef5ff", fontFamily: "Arial, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottom: "1px solid #22344a" }}>
        <div>
          <div style={{ fontSize: 11, color: "#77dba4", fontWeight: 800, letterSpacing: 2 }}>EMLAK CAFE</div>
          <h1 style={{ margin: "5px 0 0", fontSize: 24 }}>İnteraktif 360° Proje Sunumu</h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={buttonStyle}>Canlı Sunum</button>
          <button style={buttonStyle}>Paylaş</button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px" }}>
        <section style={{ minWidth: 0 }}>
          <nav style={{ display: "flex", gap: 8, padding: 12, borderBottom: "1px solid #22344a", overflowX: "auto" }}>
            {[
              ["project", "Vaziyet / 3D"],
              ["units", "Daire Bul"],
              ["tour", "360° Tur"],
              ["gallery", "Galeri"],
              ["location", "Konum"]
            ].map(([id,label]) => (
              <button
                key={id}
                onClick={() => setMode(id as Mode)}
                style={{
                  ...buttonStyle,
                  background: mode === id ? "#176be0" : "#0d1b2b"
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          <div style={{ padding: 16 }}>
            <div style={{ minHeight: 560, border: "1px solid #243954", borderRadius: 14, background: "#0c1724", overflow: "hidden" }}>
              {mode === "project" && (
                <div style={{ minHeight: 560, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
                  <div style={{ maxWidth: 700 }}>
                    <div style={{ color: "#77dba4", fontSize: 12, fontWeight: 800 }}>PROJE GENEL BAKIŞ</div>
                    <h2 style={{ fontSize: 34, margin: "12px 0" }}>Vaziyet planından daireye kadar tek akış</h2>
                    <p style={{ color: "#a9bbcd", lineHeight: 1.6 }}>
                      Gerçek proje renderı, GLB modeli veya 360 görsel seti bu alana bağlanacak.
                      Bloklar tıklanabilir olacak ve stok durumları proje üzerinde canlı gösterilecek.
                    </p>
                    <button onClick={() => setMode("units")} style={{ ...primaryStyle, marginTop: 18 }}>Daireleri Keşfet</button>
                  </div>
                </div>
              )}

              {mode === "units" && (
                <div style={{ padding: 18 }}>
                  <div style={{ marginBottom: 12, color: "#9db0c5" }}>{filtered.length} sonuç</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))", gap: 10 }}>
                    {filtered.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => setSelected(u)}
                        style={{
                          textAlign: "left",
                          padding: 14,
                          borderRadius: 10,
                          border: selected?.id === u.id ? "1px solid #6f9cff" : "1px solid #2a3d55",
                          background: selected?.id === u.id ? "#132744" : "#0d1b2b",
                          color: "#eef5ff",
                          cursor: "pointer"
                        }}
                      >
                        <strong>{u.id}</strong>
                        <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.55, color: "#a8bbce" }}>
                          {statusText[u.status]}<br/>
                          Blok {u.block} · {u.floor}. Kat<br/>
                          {u.type} · {u.area} m²<br/>
                          {u.facade} cephe
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mode === "tour" && (
                <div style={{ minHeight: 560, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
                  <div>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>360°</div>
                    <h2>{selected ? selected.id + " 360° Turu" : "360° Daire Turu"}</h2>
                    <p style={{ color: "#9db0c5", maxWidth: 560, lineHeight: 1.6 }}>
                      Panorama ve hotspot sistemi bu alana bağlanacak.
                    </p>
                  </div>
                </div>
              )}

              {mode === "gallery" && (
                <div style={{ padding: 18, display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10 }}>
                  {["Dış Cephe","Peyzaj","Salon","Mutfak","Yatak Odası","Sosyal Alan"].map((x) => (
                    <div key={x} style={{ minHeight: 180, border: "1px solid #2a3d55", borderRadius: 12, display: "grid", placeItems: "center", color: "#91a5bb" }}>{x}</div>
                  ))}
                </div>
              )}

              {mode === "location" && (
                <div style={{ minHeight: 560, display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}>
                  <div>
                    <h2>Konum & Çevre</h2>
                    <p style={{ color: "#9db0c5" }}>Harita, ulaşım süreleri ve çevre noktaları bu alanda gösterilecek.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside style={{ borderLeft: "1px solid #22344a", padding: 16, background: "#091522" }}>
          <div style={{ fontSize: 11, color: "#77dba4", fontWeight: 800, marginBottom: 8 }}>AKILLI SATIŞ PANELİ</div>
          <h2 style={{ marginTop: 0 }}>Daireleri Filtrele</h2>

          <Filter label="Blok" value={block} onChange={setBlock} options={["Tümü","A","B","C"]}/>
          <Filter label="Kat" value={floor} onChange={setFloor} options={["Tümü","1","2","3"]}/>
          <Filter label="Daire Tipi" value={type} onChange={setType} options={["Tümü","1+1","2+1","3+1","4+1"]}/>
          <Filter label="Durum" value={status} onChange={setStatus} options={["Tümü","available","reserved","sold"]}/>

          {selected ? (
            <div style={{ marginTop: 16, padding: 14, border: "1px solid #2a3d55", borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: "#8fa3b8" }}>SEÇİLEN DAİRE</div>
              <h3 style={{ margin: "6px 0 10px" }}>{selected.id}</h3>
              <div style={{ color: "#b4c4d5", lineHeight: 1.6, fontSize: 13 }}>
                Blok: {selected.block}<br/>
                Kat: {selected.floor}<br/>
                Tip: {selected.type}<br/>
                Alan: {selected.area} m²<br/>
                Cephe: {selected.facade}<br/>
                Durum: {statusText[selected.status]}
              </div>
              <button onClick={() => setMode("tour")} style={{ ...primaryStyle, marginTop: 12, width: "100%" }}>360° Daireyi Gez</button>
            </div>
          ) : (
            <div style={{ marginTop: 16, padding: 14, border: "1px dashed #38516d", borderRadius: 12, color: "#9db0c5", fontSize: 12 }}>
              Daire listesinden bir bağımsız bölüm seçin.
            </div>
          )}

          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            <button style={primaryStyle}>Teklif Hazırla</button>
            <button style={{ ...primaryStyle, background: "#1d8f5a" }}>WhatsApp ile Paylaş</button>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Filter(props: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <label style={{ display: "grid", gap: 5, fontSize: 11, color: "#8fa3b8", marginBottom: 10 }}>
      {props.label}
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ padding: 10, borderRadius: 8, border: "1px solid #2b415b", background: "#0d1b2b", color: "#eef5ff" }}
      >
        {props.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 9,
  border: "1px solid #2a435d",
  background: "#0d1b2b",
  color: "#eef5ff",
  cursor: "pointer",
  fontWeight: 700
};

const primaryStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 9,
  border: "none",
  background: "#176be0",
  color: "#fff",
  cursor: "pointer",
  fontWeight: 800
};
