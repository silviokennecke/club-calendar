import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTranslation } from "react-i18next";
import { useMapbox } from "./useMapbox";

interface Props {
  latitude: number | null;
  longitude: number | null;
  /** Click on the map or end of a marker drag. */
  onPick: (latitude: number, longitude: number) => void;
  label: string;
  describedBy?: string;
  note?: string;
  height?: number;
}

/**
 * Map of the location form (design: MapView "Position des Ortes"): click or drag the marker to set
 * the position. Keyboard users enter coordinates in the fields next to it. Loaded lazily.
 */
export default function PositionMap({
  latitude,
  longitude,
  onPick,
  label,
  describedBy,
  note,
  height = 260,
}: Props) {
  const { t } = useTranslation();
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const emitted = useRef<[number, number] | null>(null);
  const propsRef = useRef({ latitude, longitude });
  const onPickRef = useRef(onPick);
  propsRef.current = { latitude, longitude };
  onPickRef.current = onPick;
  const has = latitude != null && longitude != null;

  const { mapContainerRef, mapRef, failed } = useMapbox({
    label,
    describedBy,
    initialCenter: has ? [longitude, latitude] : [10.0, 51.0],
    initialZoom: has ? 14 : 5,
    onReady: (map, gl) => {
      const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
      const marker = new gl.Marker({ draggable: true, color: brand || undefined });
      const { latitude: lat, longitude: lng } = propsRef.current;
      if (lat != null && lng != null) marker.setLngLat([lng, lat]).addTo(map);
      marker.on("dragend", () => {
        const p = marker.getLngLat();
        emitted.current = [p.lat, p.lng];
        onPickRef.current(p.lat, p.lng);
      });
      map.on("click", (e) => {
        marker.setLngLat(e.lngLat).addTo(map);
        emitted.current = [e.lngLat.lat, e.lngLat.lng];
        onPickRef.current(e.lngLat.lat, e.lngLat.lng);
      });
      markerRef.current = marker;
    },
  });

  // Position changed from outside (address suggestion, coordinate fields): move marker and view.
  useEffect(() => {
    const marker = markerRef.current;
    const map = mapRef.current;
    if (!marker || !map) return;
    if (latitude == null || longitude == null) {
      marker.remove();
      return;
    }
    const last = emitted.current;
    if (last && last[0] === latitude && last[1] === longitude) return;
    marker.setLngLat([longitude, latitude]).addTo(map);
    map.flyTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 14) });
  }, [latitude, longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ap-map" style={{ height }}>
      <div ref={mapContainerRef} style={{ height: "100%" }} />
      {note && <span className="ap-map-note ap-map-note--top">{note}</span>}
      {failed && (
        <span
          className="ap-map-note"
          role="status"
          style={{
            top: "50%",
            bottom: "auto",
            left: "50%",
            transform: "translate(-50%, -50%)",
            maxWidth: "80%",
            textAlign: "center",
          }}
        >
          {t("settings.places.mapUnavailable")}
        </span>
      )}
    </div>
  );
}
