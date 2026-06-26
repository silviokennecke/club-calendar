'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import 'mapbox-gl/dist/mapbox-gl.css'

const BACKEND_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const mapboxApiUrlPlaceholder = 'https://dummy'

function mapboxTransformRequest(url: string) {
  if (url.startsWith(mapboxApiUrlPlaceholder)) {
    const u = new URL(url)
    u.searchParams.delete('access_token')
    const pathname = u.pathname.replace(/^\/*([^\/].*)$/, '$1');
    const newUrl = `${BACKEND_URL}/api/mapbox/${pathname}?${u.searchParams}`;
    return { url: newUrl }
  }
  return { url }
}

interface ContextItem {
  id: string
  text: string
  short_code?: string
}

interface GeocodingFeature {
  place_name: string
  center: [number, number]
  place_type: string[]
  text: string
  address?: string          // house number, present for address-type features
  context?: ContextItem[]
  properties?: { category?: string }
}

export interface GeocodedAddress {
  displayName: string
  street?: string
  zip?: string
  city?: string
  country?: string
}

interface Props {
  latitude?: number | null
  longitude?: number | null
  address?: string
  onPositionChange: (lat: number, lng: number, geocoded: GeocodedAddress) => void
}

function parseFeature(f: GeocodingFeature): GeocodedAddress {
  const ctx = f.context ?? []

  const street = f.place_type.includes('address')
    ? [f.text, f.address].filter(Boolean).join(' ')
    : undefined

  const zip = ctx.find(c => c.id.startsWith('postcode'))?.text
  const city = ctx.find(c => c.id.startsWith('place'))?.text
    ?? ctx.find(c => c.id.startsWith('locality'))?.text
  const country = ctx.find(c => c.id.startsWith('country'))?.text

  return { displayName: f.place_name, street, zip, city, country }
}

export default function MapPicker({ latitude, longitude, address, onPositionChange }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markerRef = useRef<mapboxgl.Marker | null>(null)
  const [searchQuery, setSearchQuery] = useState(address ?? '')
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return
    let map: mapboxgl.Map
    let marker: mapboxgl.Marker

    import('mapbox-gl').then(({ default: mapboxgl }) => {
      mapboxgl.accessToken = 'pk.proxy'
      const baseUrl = new URL(mapboxgl.baseApiUrl ?? 'https://api.mapbox.com')
      if (!baseUrl.toString().startsWith(mapboxApiUrlPlaceholder)) {
        mapboxgl.baseApiUrl = `${mapboxApiUrlPlaceholder}/${baseUrl.hostname}`
      }

      const initLng = longitude ?? 10.0
      const initLat = latitude ?? 51.0

      map = new mapboxgl.Map({
        container: mapContainerRef.current!,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [initLng, initLat],
        zoom: longitude != null ? 14 : 5,
        transformRequest: mapboxTransformRequest,
        performanceMetricsCollection: false,
      })

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')

      marker = new mapboxgl.Marker({ draggable: true, color: '#2563eb' })
        .setLngLat([initLng, initLat])
        .addTo(map)

      if (longitude != null) marker.setLngLat([longitude, latitude!])

      marker.on('dragend', async () => {
        const { lng, lat } = marker.getLngLat()
        const geocoded = await reverseGeocode(lng, lat)
        onPositionChange(lat, lng, geocoded)
        setSearchQuery(geocoded.displayName)
      })

      map.on('click', async (e) => {
        const { lng, lat } = e.lngLat
        marker.setLngLat([lng, lat])
        const geocoded = await reverseGeocode(lng, lat)
        onPositionChange(lat, lng, geocoded)
        setSearchQuery(geocoded.displayName)
      })

      mapRef.current = map
      markerRef.current = marker
    })

    return () => { map?.remove() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function reverseGeocode(lng: number, lat: number): Promise<GeocodedAddress> {
    const fallback: GeocodedAddress = { displayName: `${lat.toFixed(5)}, ${lng.toFixed(5)}` }
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/mapbox/api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?language=de`
      )
      const data = await res.json() as { features: GeocodingFeature[] }
      const feature = data.features[0]
      return feature ? parseFeature(feature) : fallback
    } catch {
      return fallback
    }
  }

  async function fetchSuggestions(query: string) {
    if (query.length < 2) { setSuggestions([]); return }
    const center = mapRef.current?.getCenter()
    const proximityParam = center ? `&proximity=${center.lng},${center.lat}` : ''
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/mapbox/api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?language=de&limit=6&types=address,place,poi,neighborhood,locality${proximityParam}`
      )
      const data = await res.json() as { features: GeocodingFeature[] }
      setSuggestions(data.features)
      setShowSuggestions(true)
    } catch { setSuggestions([]) }
  }

  function handleInputChange(value: string) {
    setSearchQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300)
  }

  function selectSuggestion(s: GeocodingFeature) {
    const [lng, lat] = s.center
    const geocoded = parseFeature(s)
    setSearchQuery(geocoded.displayName)
    setShowSuggestions(false)
    setSuggestions([])
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15 })
    markerRef.current?.setLngLat([lng, lat])
    onPositionChange(lat, lng, geocoded)
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
                className="w-full flex items-center gap-1 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-0"
                onMouseDown={() => selectSuggestion(s)}
              >
                <span className="truncate">{s.place_name}</span>
                {s.properties?.category && (
                  <span className="text-slate-400 text-xs ml-1 shrink-0">· {s.properties.category.split(',')[0]}</span>
                )}
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
