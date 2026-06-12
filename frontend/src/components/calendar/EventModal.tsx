'use client'
import { useState, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'
import type { CalendarEvent, Property, Feature, TargetGroup, Location, EventTemplate } from '@/lib/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Trash2, Plus, X } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import dynamic from 'next/dynamic'

const MapPicker = dynamic(() => import('@/components/locations/MapPicker'), { ssr: false, loading: () => <div className="h-48 bg-slate-100 rounded-lg animate-pulse" /> })

// ——— Recurrence helpers ———

type RecurrenceMode = 'weekly' | 'biweekly' | 'nth-weekday'
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const NTH_LABELS = ['1st', '2nd', '3rd', '4th', 'last']

function generateDates(mode: RecurrenceMode, config: RecurrenceConfig): string[] {
  const dates: string[] = []
  if (!config.from || !config.to) return dates
  const from = new Date(config.from)
  const to = new Date(config.to)
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return dates

  if (mode === 'weekly' || mode === 'biweekly') {
    const step = mode === 'biweekly' ? 14 : 7
    const weekday = config.weekday ?? 1
    // Find first occurrence of weekday >= from
    let d = new Date(from)
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1)
    while (d <= to) {
      dates.push(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + step)
    }
  } else if (mode === 'nth-weekday') {
    // Every Nth weekday of each month
    const weekday = config.weekday ?? 1
    const nth = config.nth ?? 0 // 0=1st, 1=2nd, 2=3rd, 3=4th, 4=last
    let month = new Date(from.getFullYear(), from.getMonth(), 1)
    while (month <= to) {
      const occurrences: Date[] = []
      const cur = new Date(month)
      while (cur.getMonth() === month.getMonth()) {
        if (cur.getDay() === weekday) occurrences.push(new Date(cur))
        cur.setDate(cur.getDate() + 1)
      }
      const idx = nth === 4 ? occurrences.length - 1 : nth
      const pick = occurrences[idx]
      if (pick && pick >= from && pick <= to) {
        dates.push(pick.toISOString().slice(0, 10))
      }
      month.setMonth(month.getMonth() + 1)
    }
  }
  return dates
}

interface RecurrenceConfig { from: string; to: string; weekday: number; nth: number }

// ——— Inline creator ———
function InlineCreate({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleAdd() {
    if (!value.trim()) return
    setLoading(true)
    try { await onAdd(value.trim()); setValue(''); setOpen(false) }
    finally { setLoading(false) }
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-0.5 mt-1">
      <Plus className="w-3 h-3" />New {label}
    </button>
  )
  return (
    <div className="flex items-center gap-1 mt-1">
      <Input className="h-7 text-xs flex-1" placeholder={placeholder} value={value}
        onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
      <Button size="sm" className="h-7 px-2 text-xs" disabled={loading} onClick={handleAdd}>Add</Button>
      <button onClick={() => { setOpen(false); setValue('') }} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}

// ——— Main modal ———
interface Props {
  calendarId: string
  open: boolean
  onClose: () => void
  defaultDate?: string
  event?: CalendarEvent | null
}

export default function EventModal({ calendarId, open, onClose, defaultDate, event }: Props) {
  const qc = useQueryClient()
  const isEditing = !!event

  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [timeBegin, setTimeBegin] = useState('19:00')
  const [timeEnd, setTimeEnd] = useState('21:00')
  const [isDraft, setIsDraft] = useState(true)
  const [locationId, setLocationId] = useState<number | ''>('')
  const [showMap, setShowMap] = useState(false)
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([])
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([])
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [tab, setTab] = useState<'manual' | 'template'>('manual')

  // Series state
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [recMode, setRecMode] = useState<RecurrenceMode>('weekly')
  const [recConfig, setRecConfig] = useState<RecurrenceConfig>({ from: '', to: '', weekday: 1, nth: 0 })
  const generatedDates = generateDates(recMode, recConfig)

  const { data: properties = [] } = useQuery({ queryKey: ['properties', calendarId], queryFn: () => apiGet<Property[]>(`/api/calendars/${calendarId}/properties`), enabled: open })
  const { data: features = [] } = useQuery({ queryKey: ['features', calendarId], queryFn: () => apiGet<Feature[]>(`/api/calendars/${calendarId}/features`), enabled: open })
  const { data: targetGroups = [] } = useQuery({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`), enabled: open })
  const { data: locations = [] } = useQuery({ queryKey: ['locations', calendarId], queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`), enabled: open })
  const { data: templates = [] } = useQuery({ queryKey: ['templates', calendarId], queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`), enabled: open && tab === 'template' })

  const selectedLocation = locations.find(l => l.id === locationId)

  useEffect(() => {
    if (event) {
      setName(event.name); setDate(event.date.slice(0, 10)); setTimeBegin(event.timeBegin)
      setTimeEnd(event.timeEnd); setIsDraft(event.isDraft)
      setLocationId(event.locationId ?? '')
      setSelectedPropertyIds(event.properties.map(p => p.property.id))
      setSelectedFeatureIds(event.features.map(f => f.feature.id))
      setSelectedTargetGroupIds(event.targetGroups.map(t => t.targetGroup.id))
      setShowMap(false)
    } else {
      setName(''); setDate(defaultDate ?? ''); setTimeBegin('19:00'); setTimeEnd('21:00')
      setIsDraft(true); setLocationId(''); setShowMap(false)
      setSelectedPropertyIds([]); setSelectedFeatureIds([]); setSelectedTargetGroupIds([])
    }
    setTab('manual')
  }, [event, defaultDate, open])

  function toggle<T>(arr: T[], val: T): T[] { return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }

  async function handleSubmit() {
    setLoading(true)
    try {
      const body = {
        name, date, timeBegin, timeEnd, isDraft,
        locationId: locationId === '' ? null : Number(locationId),
        propertyIds: selectedPropertyIds, featureIds: selectedFeatureIds, targetGroupIds: selectedTargetGroupIds,
      }
      if (isEditing) await apiPatch(`/api/calendars/${calendarId}/events/${event!.id}`, body)
      else await apiPost(`/api/calendars/${calendarId}/events`, body)
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally { setLoading(false) }
  }

  async function handleCreateSeries() {
    if (!templateId || generatedDates.length === 0) return
    setLoading(true)
    try {
      await apiPost(`/api/calendars/${calendarId}/events/from-template`, { templateId: Number(templateId), dates: generatedDates, overrides: { isDraft } })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally { setLoading(false) }
  }

  async function handleDelete() {
    setLoading(true)
    try {
      await apiDelete(`/api/calendars/${calendarId}/events/${event!.id}`)
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally { setLoading(false) }
  }

  // Inline creators
  async function addProperty(name: string) {
    const created = await apiPost<Property>(`/api/calendars/${calendarId}/properties`, { name })
    qc.invalidateQueries({ queryKey: ['properties', calendarId] })
    setSelectedPropertyIds(prev => [...prev, created.id])
  }
  async function addFeature(name: string) {
    const created = await apiPost<Feature>(`/api/calendars/${calendarId}/features`, { name })
    qc.invalidateQueries({ queryKey: ['features', calendarId] })
    setSelectedFeatureIds(prev => [...prev, created.id])
  }
  async function addTargetGroup(name: string) {
    const created = await apiPost<TargetGroup>(`/api/calendars/${calendarId}/target-groups`, { name })
    qc.invalidateQueries({ queryKey: ['targetGroups', calendarId] })
    setSelectedTargetGroupIds(prev => [...prev, created.id])
  }
  async function addLocation(address: string) {
    const created = await apiPost<Location>(`/api/calendars/${calendarId}/locations`, { address })
    qc.invalidateQueries({ queryKey: ['locations', calendarId] })
    setLocationId(created.id)
  }

  // When map position changes, update the location's lat/lng via PATCH
  const handleMapPositionChange = useCallback(async (lat: number, lng: number, address: string) => {
    if (!locationId) return
    await apiPatch(`/api/calendars/${calendarId}/locations/${locationId}`, { latitude: lat, longitude: lng, address })
    qc.invalidateQueries({ queryKey: ['locations', calendarId] })
  }, [locationId, calendarId, qc])

  return (
    <>
      <Dialog open={open} onOpenChange={v => !v && onClose()}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Event' : 'New Event'}</DialogTitle>
          </DialogHeader>

          {!isEditing && (
            <div className="flex gap-1 border-b pb-3 -mx-1">
              {(['manual', 'template'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`text-sm px-3 py-1.5 rounded-md transition-colors capitalize ${tab === t ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
                  {t === 'template' ? 'From Template' : 'Manual'}
                </button>
              ))}
            </div>
          )}

          {tab === 'template' && !isEditing ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Template</Label>
                <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" value={templateId} onChange={e => setTemplateId(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Select template...</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.timeBegin}–{t.timeEnd})</option>)}
                </select>
              </div>

              {/* Recurrence rule */}
              <div className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Recurrence Rule</Label>
                <div className="flex flex-wrap gap-1.5">
                  {(['weekly', 'biweekly', 'nth-weekday'] as RecurrenceMode[]).map(m => (
                    <button key={m} onClick={() => setRecMode(m)}
                      className={`text-xs px-3 py-1.5 rounded border transition-colors ${recMode === m ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {m === 'weekly' ? 'Weekly' : m === 'biweekly' ? 'Bi-weekly' : 'Monthly Nth'}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Weekday</Label>
                    <select className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm" value={recConfig.weekday} onChange={e => setRecConfig(c => ({ ...c, weekday: Number(e.target.value) }))}>
                      {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                    </select>
                  </div>
                  {recMode === 'nth-weekday' && (
                    <div className="space-y-1">
                      <Label className="text-xs">Which one</Label>
                      <select className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm" value={recConfig.nth} onChange={e => setRecConfig(c => ({ ...c, nth: Number(e.target.value) }))}>
                        {NTH_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1 min-w-0">
                    <Label className="text-xs">From</Label>
                    <Input type="date" className="h-8 text-sm w-full" value={recConfig.from} onChange={e => setRecConfig(c => ({ ...c, from: e.target.value }))} />
                  </div>
                  <div className="space-y-1 min-w-0">
                    <Label className="text-xs">To</Label>
                    <Input type="date" className="h-8 text-sm w-full" value={recConfig.to} onChange={e => setRecConfig(c => ({ ...c, to: e.target.value }))} />
                  </div>
                </div>

                {generatedDates.length > 0 ? (
                  <div>
                    <p className="text-xs text-slate-500 mb-1.5">{generatedDates.length} events will be created:</p>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                      {generatedDates.map(d => <span key={d} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{d}</span>)}
                    </div>
                  </div>
                ) : recConfig.from && recConfig.to ? (
                  <p className="text-xs text-slate-400">No dates match the rule in this range.</p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <Switch id="draft-s" checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} />
                <Label htmlFor="draft-s">Published</Label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Name + time */}
              <div className="space-y-1">
                <Label htmlFor="evt-n">Name *</Label>
                <Input id="evt-n" value={name} onChange={e => setName(e.target.value)} placeholder="Event name" />
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="space-y-1 flex-1 min-w-36"><Label htmlFor="evt-d">Date *</Label><Input id="evt-d" type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full" /></div>
                <div className="space-y-1 flex-1 min-w-28"><Label>Start</Label><Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="w-full" /></div>
                <div className="space-y-1 flex-1 min-w-28"><Label>End</Label><Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="w-full" /></div>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="evt-pub" checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} />
                <Label htmlFor="evt-pub">Published {isDraft && <span className="text-xs text-slate-400">(draft)</span>}</Label>
              </div>

              {/* Location with inline create + map */}
              <div className="space-y-1.5">
                <Label>Location</Label>
                <div className="flex gap-1.5">
                  <select className="flex-1 border border-slate-200 rounded-md px-3 py-2 text-sm" value={locationId} onChange={e => { setLocationId(e.target.value ? Number(e.target.value) : ''); setShowMap(false) }}>
                    <option value="">No location</option>
                    {locations.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name ? `${l.name} — ${l.address}` : l.address}
                      </option>
                    ))}
                  </select>
                  {locationId !== '' && (
                    <Button size="sm" variant="outline" className="h-9 px-2.5 text-xs" onClick={() => setShowMap(m => !m)}>
                      {showMap ? 'Hide map' : 'Map'}
                    </Button>
                  )}
                </div>
                {showMap && locationId !== '' && selectedLocation && (
                  <MapPicker
                    latitude={selectedLocation.latitude}
                    longitude={selectedLocation.longitude}
                    address={selectedLocation.address}
                    onPositionChange={handleMapPositionChange}
                  />
                )}
                <InlineCreate label="location" placeholder="Address" onAdd={addLocation} />
              </div>

              {/* Properties */}
              <div className="space-y-1.5">
                <Label>Properties</Label>
                <div className="flex flex-wrap gap-1.5">
                  {properties.map(p => (
                    <button key={p.id} type="button" onClick={() => setSelectedPropertyIds(toggle(selectedPropertyIds, p.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedPropertyIds.includes(p.id) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {p.icon && <span className="mr-1">{p.icon}</span>}{p.name}
                    </button>
                  ))}
                </div>
                <InlineCreate label="property" placeholder="Property name" onAdd={addProperty} />
              </div>

              {/* Features */}
              <div className="space-y-1.5">
                <Label>Features</Label>
                <div className="flex flex-wrap gap-1.5">
                  {features.map(f => (
                    <button key={f.id} type="button" onClick={() => setSelectedFeatureIds(toggle(selectedFeatureIds, f.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedFeatureIds.includes(f.id) ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
                <InlineCreate label="feature" placeholder="Feature name" onAdd={addFeature} />
              </div>

              {/* Target groups */}
              <div className="space-y-1.5">
                <Label>Target Groups</Label>
                <div className="flex flex-wrap gap-1.5">
                  {targetGroups.map(t => (
                    <button key={t.id} type="button" onClick={() => setSelectedTargetGroupIds(toggle(selectedTargetGroupIds, t.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedTargetGroupIds.includes(t.id) ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {t.name}
                    </button>
                  ))}
                </div>
                <InlineCreate label="target group" placeholder="Group name" onAdd={addTargetGroup} />
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between mt-4">
            <div>
              {isEditing && (
                <Button variant="destructive" size="sm" onClick={() => setDeleteDialogOpen(true)}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" />Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={loading || (tab === 'template' && generatedDates.length === 0 && !isEditing)}
                onClick={tab === 'template' && !isEditing ? handleCreateSeries : handleSubmit}>
                {loading ? 'Saving...' : isEditing ? 'Save' : tab === 'template' ? `Create ${generatedDates.length} Events` : 'Create'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete event?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
