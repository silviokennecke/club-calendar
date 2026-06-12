'use client'
import { useEffect, useRef } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

interface LocationPin {
  id: number
  name?: string | null
  address: string
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
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  // Keep markers in a ref so we can update them without remounting the map
  const markersRef = useRef<{ id: number; marker: mapboxgl.Marker }[]>([])

  useEffect(() => {
    if (!mapContainerRef.current || !MAPBOX_TOKEN) return
    let map: mapboxgl.Map

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      mapboxgl.accessToken = MAPBOX_TOKEN

      // Default center: central Europe
      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [10.0, 51.0],
        zoom: 5,
      })
      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      mapRef.current = map

      map.on('load', () => {
        addMarkers(mapboxgl, map)
        fitBounds(map)
      })
    })

    return () => { map?.remove(); markersRef.current = [] }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      el.title = loc.name ?? loc.address
      el.addEventListener('click', () => onSelect?.(loc.id))

      const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([loc.longitude, loc.latitude])
        .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<div style="font-size:12px"><strong>${loc.name ?? loc.address}</strong>${loc.name ? `<br/><span style="color:#64748b">${loc.address}</span>` : ''}</div>`
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

  if (!MAPBOX_TOKEN) return null

  return <div ref={mapContainerRef} className={`w-full ${height} rounded-xl border border-slate-200 overflow-hidden`} />
}
