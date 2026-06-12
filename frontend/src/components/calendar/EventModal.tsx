'use client'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'
import type { CalendarEvent, Property, Feature, TargetGroup, Location, EventTemplate } from '@/lib/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Trash2 } from 'lucide-react'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'

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
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([])
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([])
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<'manual' | 'template'>('manual')
  const [templateId, setTemplateId] = useState<number | ''>('')
  const [templateDates, setTemplateDates] = useState('')

  const { data: properties = [] } = useQuery({ queryKey: ['properties', calendarId], queryFn: () => apiGet<Property[]>(`/api/calendars/${calendarId}/properties`), enabled: open })
  const { data: features = [] } = useQuery({ queryKey: ['features', calendarId], queryFn: () => apiGet<Feature[]>(`/api/calendars/${calendarId}/features`), enabled: open })
  const { data: targetGroups = [] } = useQuery({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`), enabled: open })
  const { data: locations = [] } = useQuery({ queryKey: ['locations', calendarId], queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`), enabled: open })
  const { data: templates = [] } = useQuery({ queryKey: ['templates', calendarId], queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`), enabled: open && tab === 'template' })

  useEffect(() => {
    if (event) {
      setName(event.name)
      setDate(event.date.slice(0, 10))
      setTimeBegin(event.timeBegin)
      setTimeEnd(event.timeEnd)
      setIsDraft(event.isDraft)
      setLocationId(event.locationId ?? '')
      setSelectedPropertyIds(event.properties.map(p => p.property.id))
      setSelectedFeatureIds(event.features.map(f => f.feature.id))
      setSelectedTargetGroupIds(event.targetGroups.map(t => t.targetGroup.id))
    } else {
      setName('')
      setDate(defaultDate ?? '')
      setTimeBegin('19:00')
      setTimeEnd('21:00')
      setIsDraft(true)
      setLocationId('')
      setSelectedPropertyIds([])
      setSelectedFeatureIds([])
      setSelectedTargetGroupIds([])
    }
  }, [event, defaultDate, open])

  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      const body = {
        name, date, timeBegin, timeEnd, isDraft,
        locationId: locationId === '' ? null : Number(locationId),
        propertyIds: selectedPropertyIds,
        featureIds: selectedFeatureIds,
        targetGroupIds: selectedTargetGroupIds,
      }
      if (isEditing) {
        await apiPatch(`/api/calendars/${calendarId}/events/${event!.id}`, body)
      } else {
        await apiPost(`/api/calendars/${calendarId}/events`, body)
      }
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateSeries() {
    if (!templateId) return
    const dates = templateDates.split(',').map(d => d.trim()).filter(Boolean)
    if (dates.length === 0) return
    setLoading(true)
    try {
      await apiPost(`/api/calendars/${calendarId}/events/from-template`, { templateId: Number(templateId), dates, overrides: { isDraft } })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setLoading(true)
    try {
      await apiDelete(`/api/calendars/${calendarId}/events/${event!.id}`)
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Event' : 'New Event'}</DialogTitle>
        </DialogHeader>

        {!isEditing && (
          <div className="flex gap-2 border-b pb-3 mb-1">
            <button onClick={() => setTab('manual')} className={`text-sm px-3 py-1 rounded-md transition-colors ${tab === 'manual' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>Manual</button>
            <button onClick={() => setTab('template')} className={`text-sm px-3 py-1 rounded-md transition-colors ${tab === 'template' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:text-slate-700'}`}>From Template (Series)</button>
          </div>
        )}

        {tab === 'template' && !isEditing ? (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Template</Label>
              <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" value={templateId} onChange={e => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Select template...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Dates (comma-separated YYYY-MM-DD)</Label>
              <Input placeholder="2026-08-03, 2026-08-10, 2026-08-17" value={templateDates} onChange={e => setTemplateDates(e.target.value)} />
              <p className="text-xs text-slate-400">Each date creates one event</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="draft-series" checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} />
              <Label htmlFor="draft-series">Published</Label>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="evt-name">Name *</Label>
              <Input id="evt-name" value={name} onChange={e => setName(e.target.value)} placeholder="Event name" />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="evt-date">Date *</Label>
                <Input id="evt-date" type="date" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="evt-begin">Start</Label>
                <Input id="evt-begin" type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="evt-end">End</Label>
                <Input id="evt-end" type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="evt-draft" checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} />
              <Label htmlFor="evt-draft">Published {isDraft && <span className="text-xs text-slate-400">(draft)</span>}</Label>
            </div>

            {locations.length > 0 && (
              <div className="space-y-1">
                <Label>Location</Label>
                <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" value={locationId} onChange={e => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}>
                  <option value="">No location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.address}</option>)}
                </select>
              </div>
            )}

            {properties.length > 0 && (
              <div className="space-y-1.5">
                <Label>Properties</Label>
                <div className="flex flex-wrap gap-1.5">
                  {properties.map(p => (
                    <button key={p.id} type="button"
                      onClick={() => setSelectedPropertyIds(toggle(selectedPropertyIds, p.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedPropertyIds.includes(p.id) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {p.icon && <span className="mr-1">{p.icon}</span>}{p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {features.length > 0 && (
              <div className="space-y-1.5">
                <Label>Features</Label>
                <div className="flex flex-wrap gap-1.5">
                  {features.map(f => (
                    <button key={f.id} type="button"
                      onClick={() => setSelectedFeatureIds(toggle(selectedFeatureIds, f.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedFeatureIds.includes(f.id) ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {f.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {targetGroups.length > 0 && (
              <div className="space-y-1.5">
                <Label>Target Groups</Label>
                <div className="flex flex-wrap gap-1.5">
                  {targetGroups.map(t => (
                    <button key={t.id} type="button"
                      onClick={() => setSelectedTargetGroupIds(toggle(selectedTargetGroupIds, t.id))}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedTargetGroupIds.includes(t.id) ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between mt-4">
          <div>
            {isEditing && (
              <AlertDialog>
                <AlertDialogTrigger className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  <Trash2 className="w-3.5 h-3.5" />Delete
                </AlertDialogTrigger>
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
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={loading} onClick={tab === 'template' && !isEditing ? handleCreateSeries : handleSubmit}>
              {loading ? 'Saving...' : isEditing ? 'Save Changes' : tab === 'template' ? 'Create Series' : 'Create Event'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
