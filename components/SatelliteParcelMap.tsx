"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { ParcelPoint } from "@/lib/planning/parcelPlanner";

export default function SatelliteParcelMap({
  parcel,
  buildable
}: {
  parcel: ParcelPoint[];
  buildable: ParcelPoint[];
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || parcel.length < 3) return;

    const parcelLatLngs = parcel.map(([lon, lat]) => [lat, lon] as [number, number]);
    const buildableLatLngs = buildable.map(([lon, lat]) => [lat, lon] as [number, number]);

    const map = L.map(host, { zoomControl: true, attributionControl: true, preferCanvas: true });

    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 20, attribution: "Tiles © Esri" }
    ).addTo(map);

    const parcelPolygon = L.polygon(parcelLatLngs, {
      color: "#ff3b30",
      weight: 4,
      fillColor: "#ff3b30",
      fillOpacity: 0.08
    }).addTo(map);

    if (buildableLatLngs.length >= 3) {
      L.polygon(buildableLatLngs, {
        color: "#176be0",
        weight: 4,
        dashArray: "8 6",
        fillColor: "#176be0",
        fillOpacity: 0.16
      }).addTo(map);
    }

    map.fitBounds(parcelPolygon.getBounds(), { padding: [24, 24], maxZoom: 19 });
    setTimeout(() => map.invalidateSize(), 60);

    return () => map.remove();
  }, [parcel, buildable]);

  return <div ref={hostRef} style={{width:"100%",height:460,borderRadius:12,overflow:"hidden",background:"#dfe8ef"}} />;
}
