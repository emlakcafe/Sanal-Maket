"use client";

export type ProjectSettingsValue = {
  longSideMeters: number;
  floorHeight: number;
  roofType: "none" | "gable" | "hip";
  roofPitch: number;
  eyeHeight: number;
};

export default function ProjectSettings({
  value,
  onChange
}: {
  value: ProjectSettingsValue;
  onChange: (next: ProjectSettingsValue) => void;
}) {
  return (
    <section className="settingsPanel">
      <div className="sectionHeading">
        <div>
          <span className="eyebrow">MİMARİ AYARLAR</span>
          <h3>Ölçek ve Kat Bilgileri</h3>
        </div>
      </div>

      <div className="settingsGrid">
        <label>
          <span>Plan uzun kenarı (m)</span>
          <input type="number" min="3" max="100" step="0.1" value={value.longSideMeters}
            onChange={e => onChange({ ...value, longSideMeters: Number(e.target.value) || 10 })} />
        </label>
        <label>
          <span>Kat yüksekliği (m)</span>
          <input type="number" min="2.2" max="6" step="0.05" value={value.floorHeight}
            onChange={e => onChange({ ...value, floorHeight: Number(e.target.value) || 2.8 })} />
        </label>
        <label>
          <span>Çatı tipi</span>
          <select value={value.roofType}
            onChange={e => onChange({ ...value, roofType: e.target.value as ProjectSettingsValue["roofType"] })}>
            <option value="gable">Beşik çatı</option>
            <option value="hip">Kırma çatı</option>
            <option value="none">Çatısız</option>
          </select>
        </label>
        <label>
          <span>Çatı eğimi (°)</span>
          <input type="number" min="5" max="55" step="1" value={value.roofPitch}
            onChange={e => onChange({ ...value, roofPitch: Number(e.target.value) || 25 })} />
        </label>
        <label>
          <span>Yürüme göz yüksekliği (m)</span>
          <input type="number" min="1.2" max="2.2" step="0.05" value={value.eyeHeight}
            onChange={e => onChange({ ...value, eyeHeight: Number(e.target.value) || 1.65 })} />
        </label>
      </div>
      <div className="settingsHint">Gerçek m² hesabı için plandaki uzun kenarın gerçek ölçüsünü girin. Sonraki aşamada ölçü yazıları OCR ile otomatik okunacak.</div>
    </section>
  );
}
