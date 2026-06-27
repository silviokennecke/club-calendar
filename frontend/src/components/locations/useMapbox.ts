import { useEffect, useRef } from 'react'
import { initMapboxProxy, mapboxTransformRequest } from './mapboxProxy'

type MapboxGLModule = typeof import('mapbox-gl').default

interface UseMapboxOptions {
  initialCenter?: [number, number]
  initialZoom?: number
  onReady?: (map: mapboxgl.Map, mapboxgl: MapboxGLModule) => void
}

export function useMapbox({ initialCenter = [10.0, 51.0], initialZoom = 5, onReady }: UseMapboxOptions = {}) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return
    let map: mapboxgl.Map

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      initMapboxProxy(mapboxgl)
      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: initialCenter,
        zoom: initialZoom,
        transformRequest: mapboxTransformRequest,
        performanceMetricsCollection: false,
      })
      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      mapRef.current = map
      onReady?.(map, mapboxgl)
    })

    return () => { map?.remove() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { mapContainerRef, mapRef }
}
