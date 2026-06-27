import { useEffect, useRef } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useMapbox } from './useMapbox'

interface LocationPin {
  id: number
  name?: string | null
  street?: string | null
  zip?: string | null
  city?: string | null
  latitude: number
  longitude: number
}

interface Props {
  locations: LocationPin[]
  selectedId?: number | null
  onSelect?: (id: number) => void
  height?: string
}

export default function LocationsOverviewMap({ locations, selectedId, onSelect, height = 'h-72' }: Props) {
  // Keep markers in a ref so we can update them without remounting the map
  const markersRef = useRef<{ id: number; marker: mapboxgl.Marker }[]>([])

  const { mapContainerRef, mapRef } = useMapbox({
    onReady: (map, mapboxgl) => {
      map.on('load', () => {
        addMarkers(mapboxgl, map)
        fitBounds(map)
      })
    },
  })

  useEffect(() => {
    return () => { markersRef.current = [] }
  }, [])

  // Update markers when locations change (after initial load)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.loaded()) return

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      // Remove old markers
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current = []
      addMarkers(mapboxgl, map)
      if (locations.length > 0) fitBounds(map)
    })
  }, [locations]) // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight selected marker
  useEffect(() => {
    markersRef.current.forEach(({ id, marker }) => {
      const el = marker.getElement()
      if (id === selectedId) {
        el.style.filter = 'hue-rotate(120deg) brightness(1.2)'
        el.style.zIndex = '10'
      } else {
        el.style.filter = ''
        el.style.zIndex = ''
      }
    })
  }, [selectedId])

  function addMarkers(mapboxgl: typeof import('mapbox-gl').default, map: mapboxgl.Map) {
    for (const loc of locations) {
      const el = document.createElement('div')
      el.className = 'cursor-pointer'
      el.innerHTML = `<div style="width:28px;height:28px;background:#2563eb;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>`
      const addrLine = [loc.street, [loc.zip, loc.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      el.title = loc.name ?? addrLine
      el.addEventListener('click', () => onSelect?.(loc.id))

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([loc.longitude, loc.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div style="font-size:12px"><strong>${loc.name ?? addrLine}</strong>${loc.name && addrLine ? `<br/><span style="color:#64748b">${addrLine}</span>` : ''}</div>`
        ))
        .addTo(map)
      markersRef.current.push({ id: loc.id, marker })
    }
  }

  function fitBounds(map: mapboxgl.Map) {
    if (locations.length === 0) return
    if (locations.length === 1) {
      map.flyTo({ center: [locations[0].longitude, locations[0].latitude], zoom: 14 })
      return
    }
    const lngs = locations.map(l => l.longitude)
    const lats = locations.map(l => l.latitude)
    map.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 60, maxZoom: 14 }
    )
  }

  return <div ref={mapContainerRef} className={`w-full ${height} rounded-xl border border-slate-200 overflow-hidden`} />
}
