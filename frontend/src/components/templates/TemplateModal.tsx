'use client'
import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch } from '@/lib/api'
import type { EventTemplate, Property, Feature, TargetGroup, Location } from '@/lib/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  calendarId: string
  open: boolean
  onClose: () => void
  template?: EventTemplate | null
}

export default function TemplateModal({ calendarId, open, onClose, template }: Props) {
  const qc = useQueryClient()
  const isEditing = !!template

  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('Europe/Berlin')
  const [timeBegin, setTimeBegin] = useState('19:00')
  const [timeEnd, setTimeEnd] = useState('21:00')
  const [locationId, setLocationId] = useState<number | ''>('')
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<number[]>([])
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<number[]>([])
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)

  const { data: properties = [] } = useQuery({ queryKey: ['properties', calendarId], queryFn: () => apiGet<Property[]>(`/api/calendars/${calendarId}/properties`), enabled: open })
  const { data: features = [] } = useQuery({ queryKey: ['features', calendarId], queryFn: () => apiGet<Feature[]>(`/api/calendars/${calendarId}/features`), enabled: open })
  const { data: targetGroups = [] } = useQuery({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`), enabled: open })
  const { data: locations = [] } = useQuery({ queryKey: ['locations', calendarId], queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`), enabled: open })

  useEffect(() => {
    if (template) {
      setName(template.name)
      setTimezone(template.timezone)
      setTimeBegin(template.timeBegin)
      setTimeEnd(template.timeEnd)
      setLocationId(template.locationId ?? '')
      setSelectedPropertyIds(template.properties.map(p => p.property.id))
      setSelectedFeatureIds(template.features.map(f => f.feature.id))
      setSelectedTargetGroupIds(template.targetGroups.map(t => t.targetGroup.id))
    } else {
      setName(''); setTimezone('Europe/Berlin'); setTimeBegin('19:00'); setTimeEnd('21:00')
      setLocationId(''); setSelectedPropertyIds([]); setSelectedFeatureIds([]); setSelectedTargetGroupIds([])
    }
  }, [template, open])

  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        name, timezone, timeBegin, timeEnd,
        locationId: locationId === '' ? null : Number(locationId),
        propertyIds: selectedPropertyIds,
        featureIds: selectedFeatureIds,
        targetGroupIds: selectedTargetGroupIds,
      }
      if (isEditing) {
        await apiPatch(`/api/calendars/${calendarId}/templates/${template!.id}`, body)
      } else {
        await apiPost(`/api/calendars/${calendarId}/templates`, body)
      }
      qc.invalidateQueries({ queryKey: ['templates', calendarId] })
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Template' : 'New Template'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1">
            <Label htmlFor="tpl-name">Name *</Label>
            <Input id="tpl-name" value={name} onChange={e => setName(e.target.value)} placeholder="Template name" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1 col-span-1">
              <Label htmlFor="tpl-tz">Timezone</Label>
              <Input id="tpl-tz" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Europe/Berlin" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-begin">Start</Label>
              <Input id="tpl-begin" type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-end">End</Label>
              <Input id="tpl-end" type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} />
            </div>
          </div>

          {locations.length > 0 && (
            <div className="space-y-1">
              <Label>Default Location</Label>
              <select className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm" value={locationId} onChange={e => setLocationId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">No default location</option>
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

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
