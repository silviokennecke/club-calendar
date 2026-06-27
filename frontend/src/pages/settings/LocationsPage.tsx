import { useState, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'
import type { Location } from '@/lib/types'
import { formatAddress, formatLocationLabel } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { FormField, EmptyState } from '@/components/ui/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Plus, MapPin, Pencil, Trash2 } from 'lucide-react'
import type { GeocodedAddress } from '@/components/locations/MapPicker'

void formatLocationLabel

const MapPicker = lazy(() => import('@/components/locations/MapPicker'))
const LocationsOverviewMap = lazy(() => import('@/components/locations/LocationsOverviewMap'))

interface FormState {
  name: string
  street: string
  zip: string
  city: string
  country: string
  latitude: number | null
  longitude: number | null
}

const emptyForm: FormState = { name: '', street: '', zip: '', city: '', country: '', latitude: null, longitude: null }

export default function LocationsPage() {
  const { calendarId } = useParams<{ calendarId: string }>()
  const qc = useQueryClient()

  const [modalOpen, setModalOpen] = useState(false)
  const [editingLocation, setEditingLocation] = useState<Location | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['locations', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/locations`),
  })

  const locationsWithCoords = locations.filter(
    (l): l is Location & { latitude: number; longitude: number } =>
      l.latitude != null && l.longitude != null
  )

  function openCreate() {
    setEditingLocation(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(loc: Location) {
    setEditingLocation(loc)
    setForm({
      name: loc.name ?? '',
      street: loc.street ?? '',
      zip: loc.zip ?? '',
      city: loc.city ?? '',
      country: loc.country ?? '',
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
    })
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingLocation(null)
    setForm(emptyForm)
  }

  function handleMapPosition(lat: number, lng: number, geocoded: GeocodedAddress) {
    setForm(f => ({
      ...f,
      latitude: lat,
      longitude: lng,
      street: f.street || geocoded.street || '',
      zip: f.zip || geocoded.zip || '',
      city: f.city || geocoded.city || '',
      country: f.country || geocoded.country || '',
    }))
  }

  const mapPickerAddress = formatAddress(form) || form.street || undefined

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim() || null,
        street: form.street.trim() || null,
        zip: form.zip.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        latitude: form.latitude,
        longitude: form.longitude,
      }
      if (editingLocation) {
        await apiPatch(`/api/calendars/${calendarId}/locations/${editingLocation.id}`, payload)
      } else {
        await apiPost(`/api/calendars/${calendarId}/locations`, payload)
      }
      qc.invalidateQueries({ queryKey: ['locations', calendarId] })
      closeModal()
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await apiDelete(`/api/calendars/${calendarId}/locations/${deleteTarget.id}`)
    qc.invalidateQueries({ queryKey: ['locations', calendarId] })
    setDeleteTarget(null)
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Locations can be assigned to events and templates as the default venue.</p>
        <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />Add Location</Button>
      </div>

      {locationsWithCoords.length > 0 && (
        <Suspense fallback={<div className="h-72 bg-slate-100 rounded-xl animate-pulse" />}>
          <LocationsOverviewMap
            locations={locationsWithCoords}
            selectedId={hoveredId}
            onSelect={id => { const loc = locations.find(l => l.id === id); if (loc) openEdit(loc) }}
            height="h-72"
          />
        </Suspense>
      )}

      {locations.length === 0 ? (
        <EmptyState message="No locations yet. Add one to assign it to events and templates." />
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map(loc => {
            const addr = formatAddress(loc)
            void addr
            return (
              <div
                key={loc.id}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-200 hover:shadow-sm transition-all cursor-pointer group"
                onMouseEnter={() => setHoveredId(loc.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => openEdit(loc)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <MapPin className={`w-4 h-4 mt-0.5 shrink-0 transition-colors ${loc.latitude != null ? 'text-blue-500' : 'text-slate-300'}`} />
                    <div className="min-w-0">
                      {loc.name && <p className="text-sm font-semibold text-slate-900 truncate">{loc.name}</p>}
                      {loc.street && <p className={`text-sm truncate ${loc.name ? 'text-slate-500' : 'font-medium text-slate-800'}`}>{loc.street}</p>}
                      {(loc.zip || loc.city) && (
                        <p className="text-sm text-slate-400 truncate">{[loc.zip, loc.city].filter(Boolean).join(' ')}</p>
                      )}
                      {loc.latitude != null && (
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">{loc.latitude.toFixed(4)}, {loc.longitude!.toFixed(4)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={e => { e.stopPropagation(); openEdit(loc) }} className="p-1 text-slate-400 hover:text-slate-600 rounded">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(loc) }} className="p-1 text-slate-400 hover:text-red-500 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={v => !v && closeModal()}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLocation ? 'Edit Location' : 'New Location'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <FormField label={<>Name <span className="text-slate-400 font-normal">(optional)</span></>}>
              <Input placeholder="e.g. Main Hall" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </FormField>

            <FormField label="Street & house number">
              <Input placeholder="Musterstraße 1" value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))} />
            </FormField>

            <div className="grid grid-cols-3 gap-3">
              <FormField label="ZIP">
                <Input placeholder="12345" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))} />
              </FormField>
              <FormField label="City" className="col-span-2">
                <Input placeholder="Berlin" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </FormField>
            </div>

            <FormField label={<>Country <span className="text-slate-400 font-normal">(optional)</span></>}>
              <Input placeholder="Germany" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} />
            </FormField>

            <FormField label={<>Map position <span className="text-slate-400 font-normal">(search or click/drag)</span></>}>
              <Suspense fallback={<div className="h-56 bg-slate-100 rounded-lg animate-pulse" />}>
                <MapPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  address={mapPickerAddress}
                  onPositionChange={handleMapPosition}
                />
              </Suspense>
            </FormField>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>Cancel</Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? 'Saving…' : editingLocation ? 'Save Changes' : 'Add Location'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete location?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget ? (deleteTarget.name ?? formatAddress(deleteTarget) ?? 'this location') : ''}&rdquo; will be removed. Events using this location will lose the reference.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
