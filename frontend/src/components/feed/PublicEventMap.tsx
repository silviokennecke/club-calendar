import "mapbox-gl/dist/mapbox-gl.css";
import { useTranslation } from "react-i18next";
import { useMapbox } from "@/components/locations/useMapbox";

interface Props {
  latitude: number;
  longitude: number;
  /** Accessible name ("Karte mit Markierung für …"). */
  label: string;
  height?: number;
}

/**
 * Read-only map with one marker (design: PublicEvent MapView). The address and the "open in maps
 * app" link next to it are the text alternative. Tiles load through the backend proxy only; no
 * address of the page (which may hold a secret) goes to a third party. Loaded lazily.
 */
export default function PublicEventMap({ latitude, longitude, label, height = 220 }: Props) {
  const { t } = useTranslation();
  const { mapContainerRef, failed } = useMapbox({
    label,
    initialCenter: [longitude, latitude],
    initialZoom: 14,
    onReady: (map, gl) => {
      const brand = getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
      new gl.Marker({ color: brand || undefined }).setLngLat([longitude, latitude]).addTo(map);
    },
  });

  return (
    <div className="ap-map" style={{ height }}>
      <div ref={mapContainerRef} style={{ height: "100%" }} />
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
          {t("feed.event.mapUnavailable")}
        </span>
      )}
    </div>
  );
}
