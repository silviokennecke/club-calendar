'use client'
import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
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
  const [searching, setSearching] = useState(false)

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

  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&language=de&limit=1`
      )
      const data = await res.json() as { features: { center: [number, number]; place_name: string }[] }
      if (data.features.length > 0) {
        const [lng, lat] = data.features[0].center
        const addr = data.features[0].place_name
        mapRef.current?.flyTo({ center: [lng, lat], zoom: 15 })
        markerRef.current?.setLngLat([lng, lat])
        onPositionChange(lat, lng, addr)
        setSearchQuery(addr)
      }
    } finally { setSearching(false) }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search address..."
          className="flex-1 h-8 text-sm"
        />
        <Button size="sm" variant="outline" disabled={searching} onClick={handleSearch} className="h-8 px-2">
          <Search className="w-3.5 h-3.5" />
        </Button>
      </div>
      <div ref={mapContainerRef} className="w-full h-48 rounded-lg border border-slate-200 overflow-hidden" />
      <p className="text-xs text-slate-400">Click map or drag marker to set position</p>
    </div>
  )
}
