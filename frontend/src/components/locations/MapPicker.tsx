'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic2lsdmlva2VubmVja2UiLCJhIjoiQmN4cXI4VSJ9.OAictxniq7_TyKwEV3b0qA'

interface Props {
  latitude?: number | null
  longitude?: number | null
  address?: string
  onPositionChange: (lat: number, lng: number, address: string) => void
}

export default function MapPicker({ latitude, longitude, address, onPositionChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const [searchQuery, setSearchQuery] = useState(address ?? '')
  const [suggestions, setSuggestions] = useState<{ place_name: string; center: [number, number] }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lazy-load mapbox-gl (client only)
  useEffect(() => {
    if (!mapContainerRef.current) return
    let map: mapboxgl.Map
    let marker: mapboxgl.Marker

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      mapboxgl.accessToken = MAPBOX_TOKEN

      const initLng = longitude ?? 10.0  // default: central Europe
      const initLat = latitude ?? 51.0

      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [initLng, initLat],
        zoom: longitude != null ? 14 : 5,
      })

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')

      marker = new mapboxgl.Marker({ draggable: true, color: '#2563eb' })
        .setLngLat([initLng, initLat])
        .addTo(map)

      if (longitude != null) {
        marker.setLngLat([longitude, latitude!])
      }

      marker.on('dragend', async () => {
        const { lng, lat } = marker.getLngLat()
        const addr = await reverseGeocode(lng, lat)
        onPositionChange(lat, lng, addr)
        setSearchQuery(addr)
      })

      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat
        marker.setLngLat([lng, lat])
        const addr = await reverseGeocode(lng, lat)
        onPositionChange(lat, lng, addr)
        setSearchQuery(addr)
      })

      mapRef.current = map
      markerRef.current = marker
    })

    return () => { map?.remove() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function reverseGeocode(lng: number, lat: number): Promise<string> {
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=de`
      )
      const data = await res.json() as { features: { place_name: string }[] }
      return data.features[0]?.place_name ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    } catch {
      return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
    }
  }

  async function fetchSuggestions(query: string) {
    if (query.length < 3) { setSuggestions([]); return }
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&language=de&limit=5&types=address,place,poi`
      )
      const data = await res.json() as { features: { place_name: string; center: [number, number] }[] }
      setSuggestions(data.features)
      setShowSuggestions(true)
    } catch { setSuggestions([]) }
  }

  function handleInputChange(value: string) {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300)
  }

  function selectSuggestion(s: { place_name: string; center: [number, number] }) {
    const [lng, lat] = s.center
    setSearchQuery(s.place_name)
    setShowSuggestions(false)
    setSuggestions([])
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15 })
    markerRef.current?.setLngLat([lng, lat])
    onPositionChange(lat, lng, s.place_name)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={searchQuery}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Search address..."
          className="w-full h-8 text-sm"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 truncate border-b border-slate-100 last:border-0"
                onMouseDown={() => selectSuggestion(s)}
              >
                {s.place_name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={mapContainerRef} className="w-full h-56 rounded-lg border border-slate-200 overflow-hidden" />
      <p className="text-xs text-slate-400">Click map or drag marker to set position</p>
    </div>
  )
}
