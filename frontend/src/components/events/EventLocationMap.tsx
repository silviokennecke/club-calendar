import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMapbox } from "@/components/locations/useMapbox";
import type { Location } from "@/lib/types";

interface EventLocationMapProps {
  location: Location;
  /** "Position korrigieren": marker draggable and map clicks move it. */
  fixing: boolean;
  onMove: (latitude: number, longitude: number) => void;
  label: string;
  note: string;
  height?: number;
}

/**
 * Map of the selected location in the event form (design: MapView). Read-only until the user
 * switches on "Position korrigieren". Loaded lazily (mapbox-gl is large).
 */
export default function EventLocationMap({
  location,
  fixing,
  onMove,
  label,
  note,
  height = 220,
}: EventLocationMapProps) {
  const hasPosition = location.latitude != null && location.longitude != null;
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const fixingRef = useRef(fixing);
  const onMoveRef = useRef(onMove);
  fixingRef.current = fixing;
  onMoveRef.current = onMove;

  const { mapContainerRef } = useMapbox({
    initialCenter: hasPosition ? [location.longitude!, location.latitude!] : [10.0, 51.0],
    initialZoom: hasPosition ? 14 : 5,
    onReady: (map, mapboxgl) => {
      const marker = new mapboxgl.Marker({ draggable: fixingRef.current });
      if (hasPosition) marker.setLngLat([location.longitude!, location.latitude!]).addTo(map);
      marker.on("dragend", () => {
        const { lng, lat } = marker.getLngLat();
        onMoveRef.current(lat, lng);
      });
      map.on("click", (e) => {
        if (!fixingRef.current) return;
        marker.setLngLat(e.lngLat).addTo(map);
        onMoveRef.current(e.lngLat.lat, e.lngLat.lng);
      });
      markerRef.current = marker;
    },
  });

  useEffect(() => {
    markerRef.current?.setDraggable(fixing);
  }, [fixing]);

  return (
    <div className="ap-map" style={{ height }}>
      <div ref={mapContainerRef} role="region" aria-label={label} style={{ height: "100%" }} />
      <span className="ap-map-note">{note}</span>
    </div>
  );
}
