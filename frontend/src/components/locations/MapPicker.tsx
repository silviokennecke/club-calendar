import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import "mapbox-gl/dist/mapbox-gl.css";
import { useMapbox } from "./useMapbox";
import { apiFetch } from "@/lib/api";

export interface GeocodedAddress {
  label: string;
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
}

interface SuggestionResult {
  label: string;
  lat: number;
  lng: number;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
}

interface Props {
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  onPositionChange: (lat: number, lng: number, geocoded: GeocodedAddress) => void;
}

export default function MapPicker({ latitude, longitude, address, onPositionChange }: Props) {
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [searchQuery, setSearchQuery] = useState(address ?? "");
  const [suggestions, setSuggestions] = useState<SuggestionResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initLng = longitude ?? 10.0;
  const initLat = latitude ?? 51.0;

  const { mapContainerRef, mapRef } = useMapbox({
    initialCenter: [initLng, initLat],
    initialZoom: longitude != null ? 14 : 5,
    onReady: (map, mapboxgl) => {
      const marker = new mapboxgl.Marker({ draggable: true, color: "#2563eb" })
        .setLngLat([initLng, initLat])
        .addTo(map);

      if (longitude != null) marker.setLngLat([longitude, latitude!]);

      marker.on("dragend", async () => {
        const { lng, lat } = marker.getLngLat();
        const geocoded = await reverseGeocode(lng, lat);
        onPositionChange(lat, lng, geocoded);
        setSearchQuery(geocoded.label);
      });

      map.on("click", async (e) => {
        const { lng, lat } = e.lngLat;
        marker.setLngLat([lng, lat]);
        const geocoded = await reverseGeocode(lng, lat);
        onPositionChange(lat, lng, geocoded);
        setSearchQuery(geocoded.label);
      });

      markerRef.current = marker;
    },
  });

  async function reverseGeocode(lng: number, lat: number): Promise<GeocodedAddress> {
    const fallback: GeocodedAddress = { label: `${lat.toFixed(5)}, ${lng.toFixed(5)}` };
    try {
      const res = await apiFetch(`/api/map/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (!res.ok) return fallback;
      const data = (await res.json()) as GeocodedAddress;
      return data;
    } catch {
      return fallback;
    }
  }

  async function fetchSuggestions(query: string) {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const center = mapRef.current?.getCenter();
    const proximityParams = center ? `&lat=${center.lat}&lng=${center.lng}` : "";
    try {
      const res = await apiFetch(
        `/api/map/geocode/suggest?q=${encodeURIComponent(query)}${proximityParams}&limit=6`,
      );
      if (!res.ok) {
        setSuggestions([]);
        return;
      }
      const data = (await res.json()) as { suggestions: SuggestionResult[] };
      setSuggestions(data.suggestions);
      setShowSuggestions(true);
    } catch {
      setSuggestions([]);
    }
  }

  function handleInputChange(value: string) {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  }

  function selectSuggestion(s: SuggestionResult) {
    const geocoded: GeocodedAddress = {
      label: s.label,
      street: s.street ?? undefined,
      zip: s.zip ?? undefined,
      city: s.city ?? undefined,
      country: s.country ?? undefined,
    };
    setSearchQuery(geocoded.label);
    setShowSuggestions(false);
    setSuggestions([]);
    mapRef.current?.flyTo({ center: [s.lng, s.lat], zoom: 15 });
    markerRef.current?.setLngLat([s.lng, s.lat]);
    onPositionChange(s.lat, s.lng, geocoded);
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={searchQuery}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Search address..."
          className="h-8 w-full text-sm"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute top-full right-0 left-0 z-50 mt-0.5 max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="flex w-full items-center gap-1 border-b border-slate-100 px-3 py-2 text-xs text-slate-700 last:border-0 hover:bg-slate-50"
                onMouseDown={() => selectSuggestion(s)}
              >
                <span className="truncate">{s.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={mapContainerRef}
        className="h-56 w-full overflow-hidden rounded-lg border border-slate-200"
      />
      <p className="text-xs text-slate-400">Click map or drag marker to set position</p>
    </div>
  );
}
