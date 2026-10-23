import { useState } from "react";
import { useTranslation } from "react-i18next";
import { API_URL } from "@/lib/apiUrl";
import type { Location } from "@/lib/types";

/**
 * Static map image of the selected location (`/api/map/image/location/{id}`, 800x288). The
 * position is part of the cache-buster, so a moved pin loads a new image.
 */
export function LocationImage({ location, label }: { location: Location; label: string }) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const v = encodeURIComponent(`${location.latitude},${location.longitude}`);
  if (failed) return <p className="t-sm t-muted">{t("feed.event.mapUnavailable")}</p>;
  return (
    <img
      src={`${API_URL}/api/map/image/location/${encodeURIComponent(location.id)}?v=${v}`}
      alt={label}
      width={800}
      height={288}
      loading="lazy"
      decoding="async"
      className="ap-map object-cover"
      style={{ height: "auto", aspectRatio: "800 / 288" }}
      onError={() => setFailed(true)}
    />
  );
}
