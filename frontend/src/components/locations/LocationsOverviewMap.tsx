import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import { useTranslation } from "react-i18next";
import { useMapbox } from "./useMapbox";

type MapboxGLModule = typeof import("mapbox-gl").default;

export interface LocationPin {
  id: string;
  /** Accessible name and tooltip of the pin. */
  title: string;
  latitude: number;
  longitude: number;
}

interface Props {
  locations: LocationPin[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Accessible name of the map region. */
  label: string;
  /** Id of an element that describes the map (the list is the full alternative). */
  describedBy?: string;
  /** Short caption in the map corner. */
  note?: string;
  height?: number;
}

/**
 * Overview of all positioned locations (design: MapView). Pins are real buttons (keyboard,
 * accessible names); the list next to the map is the complete alternative for screen readers.
 */
export default function LocationsOverviewMap({
  locations,
  selectedId,
  onSelect,
  label,
  describedBy,
  note,
  height = 360,
}: Props) {
  const { t } = useTranslation();
  const markersRef = useRef<{ id: string; marker: mapboxgl.Marker; el: HTMLButtonElement }[]>([]);
  const glRef = useRef<MapboxGLModule | null>(null);
  const locationsRef = useRef(locations);
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  locationsRef.current = locations;
  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;

  const { mapContainerRef, mapRef, failed } = useMapbox({
    label,
    describedBy,
    onReady: (map, gl) => {
      glRef.current = gl;
      syncMarkers();
      fit(map);
    },
  });

  function syncMarkers() {
    const map = mapRef.current;
    const gl = glRef.current;
    if (!map || !gl) return;
    markersRef.current.forEach(({ marker }) => marker.remove());
    markersRef.current = locationsRef.current.map((loc) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ap-pin";
      el.setAttribute("aria-label", loc.title);
      el.title = loc.title;
      if (loc.id === selectedRef.current) {
        el.setAttribute("aria-current", "true");
        el.style.zIndex = "2";
      }
      el.addEventListener("click", () => onSelectRef.current?.(loc.id));
      const marker = new gl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([loc.longitude, loc.latitude])
        .addTo(map);
      // Mapbox labels custom marker elements role="img"; a native button keeps its own role.
      el.removeAttribute("role");
      return { id: loc.id, marker, el };
    });
  }

  function fit(map: mapboxgl.Map) {
    const list = locationsRef.current;
    if (list.length === 0) return;
    if (list.length === 1) {
      map.jumpTo({ center: [list[0].longitude, list[0].latitude], zoom: 14 });
      return;
    }
    const lngs = list.map((l) => l.longitude);
    const lats = list.map((l) => l.latitude);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 60, maxZoom: 14, duration: 0 },
    );
  }

  // Locations changed: rebuild the pins and frame them.
  useEffect(() => {
    if (!mapRef.current || !glRef.current) return;
    syncMarkers();
    fit(mapRef.current);
  }, [locations]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection changed: mark the pin and bring it into view.
  useEffect(() => {
    markersRef.current.forEach(({ id, el }) => {
      if (id === selectedId) {
        el.setAttribute("aria-current", "true");
        el.style.zIndex = "2";
      } else {
        el.removeAttribute("aria-current");
        el.style.zIndex = "";
      }
    });
    const loc = locationsRef.current.find((l) => l.id === selectedId);
    if (loc && mapRef.current) {
      mapRef.current.easeTo({ center: [loc.longitude, loc.latitude], duration: 400 });
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

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
