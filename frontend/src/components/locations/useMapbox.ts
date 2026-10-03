import { useEffect, useRef, useState } from "react";
import { initMapboxProxy, mapboxTransformRequest } from "./mapboxProxy";

type MapboxGLModule = typeof import("mapbox-gl").default;

interface UseMapboxOptions {
  initialCenter?: [number, number];
  initialZoom?: number;
  onReady?: (map: mapboxgl.Map, mapboxgl: MapboxGLModule) => void;
  /**
   * Accessible name of the map. Mapbox exposes its canvas as a "Map" region; with a label the
   * canvas itself carries the name (several maps on a page stay distinguishable).
   */
  label?: string;
  /** Id of an element describing the map; set on the canvas. */
  describedBy?: string;
}

export function useMapbox({
  initialCenter = [10.0, 51.0],
  initialZoom = 5,
  onReady,
  label,
  describedBy,
}: UseMapboxOptions = {}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  /** The map cannot show its base map (no WebGL, style or token not available). */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    let map: mapboxgl.Map | undefined;
    // Effects run twice in development and the chunk loads asynchronously: never build a map for
    // an effect that was already cleaned up.
    let cancelled = false;

    import("mapbox-gl")
      .then(({ default: mapboxgl }) => {
        if (cancelled || !mapContainerRef.current) return; // unmounted while loading
        initMapboxProxy(mapboxgl);
        map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: initialCenter,
          zoom: initialZoom,
          transformRequest: mapboxTransformRequest,
          performanceMetricsCollection: false,
          ...(label ? { locale: { "Map.Title": label } } : {}),
        });
        map.addControl(new mapboxgl.NavigationControl(), "top-right");
        if (describedBy) map.getCanvas().setAttribute("aria-describedby", describedBy);
        // Tiles may fail one by one; a missing style means the base map is gone.
        map.on("error", () => {
          if (map && !map.isStyleLoaded()) setFailed(true);
        });
        map.on("style.load", () => setFailed(false));
        mapRef.current = map;
        onReady?.(map, mapboxgl);
      })
      .catch((error: unknown) => {
        // No WebGL or the chunk failed: the pages stay usable without the map.
        console.warn("Map could not be initialised", error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { mapContainerRef, mapRef, failed };
}
