'use client'
import { use, useState, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiGet, apiPost } from '@/lib/api'
import type { Property, Feature, TargetGroup, Location } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, ChevronDown, Upload, Check, Pencil, X, Settings2 } from 'lucide-react'

interface ParsedEvent {
  uid: string
  name: string
  date: string
  timeBegin: string
  timeEnd: string
  timezone: string | null
  locationText: string   // raw LOCATION field from ICS
  isDraft: boolean
  propertyIds: number[]
  featureIds: number[]
  targetGroupIds: number[]
  selected: boolean
}

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

function parseIcs(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  const blocks = text.split('BEGIN:VEVENT').slice(1)
  for (const block of blocks) {
    try {
      const get = (key: string) => {
        const match = block.match(new RegExp(`(?:^|\\n)${key}[^:]*:([^\\r\\n]*)`, 'i'))
        return match ? match[1].trim() : ''
      }
      const summary = get('SUMMARY').replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\/g, '')
      if (!summary) continue
      const uid = get('UID') || `imported-${Math.random().toString(36).slice(2)}`
      const dtstart = get('DTSTART')
      if (!dtstart) continue
      let date = '', timeBegin = '00:00', timezone: string | null = null
      const tzMatch = block.match(/DTSTART;TZID=([^:]+):/i)
      if (tzMatch) timezone = tzMatch[1].trim()
      if (dtstart.length >= 8) {
        date = `${dtstart.slice(0, 4)}-${dtstart.slice(4, 6)}-${dtstart.slice(6, 8)}`
        if (dtstart.length >= 13) timeBegin = `${dtstart.slice(9, 11)}:${dtstart.slice(11, 13)}`
      }
      if (!date) continue
      const dtend = get('DTEND')
      let timeEnd = timeBegin
      if (dtend && dtend.length >= 13) {
        const endDateStr = `${dtend.slice(0, 4)}-${dtend.slice(4, 6)}-${dtend.slice(6, 8)}`
        if (endDateStr === date) timeEnd = `${dtend.slice(9, 11)}:${dtend.slice(11, 13)}`
      }
      const locationText = get('LOCATION').replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\/g, '')
      events.push({ uid, name: summary, date, timeBegin, timeEnd, timezone, locationText, isDraft: true, propertyIds: [], featureIds: [], targetGroupIds: [], selected: true })
    } catch { /* skip malformed */ }
  }
  return events
}

// ——— Shared chip-toggle fields used in both editors ———
function RelationFields({ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds, onToggleProp, onToggleFeat, onToggleTg }: {
  properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  propertyIds: number[]; featureIds: number[]; targetGroupIds: number[]
  onToggleProp: (id: number) => void; onToggleFeat: (id: number) => void; onToggleTg: (id: number) => void
}) {
  return (
    <>
      {targetGroups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-16">Groups</span>
          {targetGroups.map(tg => (
            <button key={tg.id} type="button" onClick={() => onToggleTg(tg.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${targetGroupIds.includes(tg.id) ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-purple-200'}`}>
              {tg.name}
            </button>
          ))}
        </div>
      )}
      {properties.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-16">Properties</span>
          {properties.map(p => (
            <button key={p.id} type="button" onClick={() => onToggleProp(p.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${propertyIds.includes(p.id) ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-200'}`}>
              {p.icon && <span className="mr-1">{p.icon}</span>}{p.name}
            </button>
          ))}
        </div>
      )}
      {features.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-16">Features</span>
          {features.map(f => (
            <button key={f.id} type="button" onClick={() => onToggleFeat(f.id)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${featureIds.includes(f.id) ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-green-200'}`}>
              {f.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// ——— Per-row inline editor ———
function RowEditor({ ev, properties, features, targetGroups, onSave, onClose }: {
  ev: ParsedEvent; properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  onSave: (patch: Partial<ParsedEvent>) => void; onClose: () => void
}) {
  const [name, setName] = useState(ev.name)
  const [date, setDate] = useState(ev.date)
  const [timeBegin, setTimeBegin] = useState(ev.timeBegin)
  const [timeEnd, setTimeEnd] = useState(ev.timeEnd)
  const [isDraft, setIsDraft] = useState(ev.isDraft)
  const [propertyIds, setPropertyIds] = useState(ev.propertyIds)
  const [featureIds, setFeatureIds] = useState(ev.featureIds)
  const [targetGroupIds, setTargetGroupIds] = useState(ev.targetGroupIds)
  function toggle<T>(arr: T[], val: T) { return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }
  return (
    <div className="px-4 py-3 bg-blue-50/60 border-t border-blue-100 space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1 flex-1 min-w-40"><Label className="text-xs">Name</Label><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" /></div>
        <div className="space-y-1 min-w-36"><Label className="text-xs">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="space-y-1 min-w-28"><Label className="text-xs">Start</Label><Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="space-y-1 min-w-28"><Label className="text-xs">End</Label><Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="flex items-end pb-0.5 gap-2"><Switch id={`d-${ev.uid}`} checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} /><Label htmlFor={`d-${ev.uid}`} className="text-xs">Published</Label></div>
      </div>
      <RelationFields {...{ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds }}
        onToggleProp={id => setPropertyIds(toggle(propertyIds, id))}
        onToggleFeat={id => setFeatureIds(toggle(featureIds, id))}
        onToggleTg={id => setTargetGroupIds(toggle(targetGroupIds, id))} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onSave({ name, date, timeBegin, timeEnd, isDraft, propertyIds, featureIds, targetGroupIds }); onClose() }}><Check className="w-3.5 h-3.5 mr-1" />Apply</Button>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
      </div>
    </div>
  )
}

// ——— Group-level settings editor ———
function GroupEditor({ groupName, items, properties, features, targetGroups, onApply, onClose }: {
  groupName: string; items: ParsedEvent[]
  properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  onApply: (patch: Partial<ParsedEvent>) => void; onClose: () => void
}) {
  // Derive initial state from first item (as representative)
  const first = items[0]
  const [name, setName] = useState(groupName)
  const [timeBegin, setTimeBegin] = useState(first.timeBegin)
  const [timeEnd, setTimeEnd] = useState(first.timeEnd)
  const [isDraft, setIsDraft] = useState(first.isDraft)
  // Start with ids that ALL items in the group already have (intersection)
  const [propertyIds, setPropertyIds] = useState<number[]>(
    first.propertyIds.filter(id => items.every(e => e.propertyIds.includes(id)))
  )
  const [featureIds, setFeatureIds] = useState<number[]>(
    first.featureIds.filter(id => items.every(e => e.featureIds.includes(id)))
  )
  const [targetGroupIds, setTargetGroupIds] = useState<number[]>(
    first.targetGroupIds.filter(id => items.every(e => e.targetGroupIds.includes(id)))
  )
  function toggle<T>(arr: T[], val: T) { return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }
  return (
    <div className="px-4 py-4 bg-amber-50/60 border-b border-amber-200 space-y-3">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Edit all {items.length} events in this group</p>
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1 flex-1 min-w-40"><Label className="text-xs">Rename all</Label><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" /></div>
        <div className="space-y-1 min-w-28"><Label className="text-xs">Start (all)</Label><Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="space-y-1 min-w-28"><Label className="text-xs">End (all)</Label><Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="flex items-end pb-0.5 gap-2"><Switch id={`gd-${groupName}`} checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} /><Label htmlFor={`gd-${groupName}`} className="text-xs">Published</Label></div>
      </div>
      <RelationFields {...{ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds }}
        onToggleProp={id => setPropertyIds(toggle(propertyIds, id))}
        onToggleFeat={id => setFeatureIds(toggle(featureIds, id))}
        onToggleTg={id => setTargetGroupIds(toggle(targetGroupIds, id))} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onApply({ name, timeBegin, timeEnd, isDraft, propertyIds, featureIds, targetGroupIds }); onClose() }}>
          <Check className="w-3.5 h-3.5 mr-1" />Apply to all {items.length}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="w-3.5 h-3.5 mr-1" />Cancel</Button>
      </div>
    </div>
  )
}

// ——— Main page ———
export default function ImportPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [events, setEvents] = useState<ParsedEvent[]>([])
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [editingUid, setEditingUid] = useState<string | null>(null)
  const [editingGroup, setEditingGroup] = useState<string | null>(null)

  const { data: properties = [] } = useQuery<Property[]>({ queryKey: ['properties', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/properties`), enabled: step === 'review' })
  const { data: features = [] } = useQuery<Feature[]>({ queryKey: ['features', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/features`), enabled: step === 'review' })
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`), enabled: step === 'review' })
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ['locations', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/locations`), enabled: step === 'review' })

  const groups = useMemo(() => {
    const map = new Map<string, ParsedEvent[]>()
    for (const ev of events) {
      const key = ev.name
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(ev)
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }))
  }, [events])

  function handleFile(file: File) {
    if (!file.name.endsWith('.ics') && file.type !== 'text/calendar') { alert('Please select an .ics file'); return }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseIcs(text)
      if (parsed.length === 0) { alert('No events found in this ICS file'); return }
      setEvents(parsed)
      setExpandedGroups(new Set())
      setStep('review')
    }
    reader.readAsText(file)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function updateEvent(uid: string, patch: Partial<ParsedEvent>) {
    setEvents(prev => prev.map(ev => ev.uid === uid ? { ...ev, ...patch } : ev))
  }

  function updateGroup(groupName: string, patch: Partial<ParsedEvent>) {
    setEvents(prev => prev.map(ev => ev.name === groupName ? { ...ev, ...patch } : ev))
  }

  function toggleGroupExpand(name: string) {
    setExpandedGroups(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })
  }

  function toggleGroupSelection(groupName: string) {
    const groupItems = events.filter(e => e.name === groupName)
    const allSel = groupItems.every(e => e.selected)
    setEvents(prev => prev.map(e => e.name === groupName ? { ...e, selected: !allSel } : e))
  }

  const selectedEvents = events.filter(e => e.selected)
  const allSelected = events.length > 0 && selectedEvents.length === events.length

  function toggleAll() { const n = !allSelected; setEvents(prev => prev.map(e => ({ ...e, selected: n }))) }
  function bulkSetDraft(isDraft: boolean) { setEvents(prev => prev.map(e => e.selected ? { ...e, isDraft } : e)) }
  function bulkToggleIds(field: 'propertyIds' | 'featureIds' | 'targetGroupIds', id: number) {
    const allHave = selectedEvents.every(e => e[field].includes(id))
    setEvents(prev => prev.map(e => {
      if (!e.selected) return e
      const arr = e[field]
      return { ...e, [field]: allHave ? arr.filter(x => x !== id) : [...new Set([...arr, id])] }
    }))
  }

  async function handleImport() {
    const toImport = events.filter(e => e.selected)
    if (toImport.length === 0) return
    setImporting(true)
    try {
      // Resolve locations: match by address, create missing ones
      const uniqueTexts = [...new Set(toImport.map(e => e.locationText).filter(Boolean))]
      const locationIdMap = new Map<string, number>()
      for (const text of uniqueTexts) {
        const existing = locations.find(l => l.address.toLowerCase() === text.toLowerCase())
        if (existing) {
          locationIdMap.set(text, existing.id)
        } else {
          const created = await apiPost<Location>(`/api/calendars/${calendarId}/locations`, { address: text })
          locationIdMap.set(text, created.id)
        }
      }
      const result = await apiPost<{ imported: number }>(
        `/api/calendars/${calendarId}/events/import`,
        {
          events: toImport.map(({ uid: _uid, selected: _s, locationText, ...rest }) => ({
            ...rest,
            locationId: locationText ? (locationIdMap.get(locationText) ?? null) : null,
          }))
        }
      )
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      qc.invalidateQueries({ queryKey: ['locations', calendarId] })
      setImportedCount(result.imported)
      setStep('done')
    } catch (e) {
      alert((e as Error).message ?? 'Import failed')
    } finally { setImporting(false) }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-4 h-4" /></Link>
        <h1 className="text-base font-semibold text-slate-900">Import Events from ICS</h1>
      </div>

      {/* Upload */}
      {step === 'upload' && (
        <div className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop an ICS file here</p>
          <p className="text-sm text-slate-400 mt-1">or click to browse</p>
          <input ref={fileInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {/* Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">{events.length}</span> events · <span className="font-semibold">{groups.length}</span> groups · <span className="font-semibold">{selectedEvents.length}</span> selected
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setStep('upload'); setEvents([]) }}>← Back</Button>
              <Button size="sm" disabled={importing || selectedEvents.length === 0} onClick={handleImport}>
                {importing ? 'Importing…' : `Import ${selectedEvents.length} event${selectedEvents.length !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>

          {/* Global bulk panel */}
          {selectedEvents.length > 0 && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Bulk assign to {selectedEvents.length} selected</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">Status</span>
                <button onClick={() => bulkSetDraft(false)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">Published</button>
                <button onClick={() => bulkSetDraft(true)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-slate-300 transition-colors">Draft</button>
              </div>
              {targetGroups.length > 0 && <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">Groups</span>
                {targetGroups.map(tg => { const all = selectedEvents.every(e => e.targetGroupIds.includes(tg.id)); return <button key={tg.id} onClick={() => bulkToggleIds('targetGroupIds', tg.id)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${all ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-purple-200'}`}>{tg.name}</button> })}
              </div>}
              {properties.length > 0 && <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">Properties</span>
                {properties.map(p => { const all = selectedEvents.every(e => e.propertyIds.includes(p.id)); return <button key={p.id} onClick={() => bulkToggleIds('propertyIds', p.id)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${all ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-200'}`}>{p.icon && <span className="mr-1">{p.icon}</span>}{p.name}</button> })}
              </div>}
              {features.length > 0 && <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">Features</span>
                {features.map(f => { const all = selectedEvents.every(e => e.featureIds.includes(f.id)); return <button key={f.id} onClick={() => bulkToggleIds('featureIds', f.id)} className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${all ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-green-200'}`}>{f.name}</button> })}
              </div>}
            </div>
          )}

          {/* Grouped table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="grid grid-cols-[2rem_1.5rem_1fr_6rem_4rem_4rem_4rem_2.5rem_2.5rem] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="mt-0.5" />
              <span />
              <span>Name</span>
              <span>Date</span>
              <span>Start</span>
              <span>End</span>
              <span>Location</span>
              <span />
              <span />
            </div>

            <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {groups.map(({ name: groupName, items }) => {
                const isExpanded = expandedGroups.has(groupName)
                const groupSelected = items.filter(e => e.selected).length
                const allGroupSelected = groupSelected === items.length
                const isGroupEditing = editingGroup === groupName
                // Show location summary for the group (unique locations)
                const locTexts = [...new Set(items.map(e => e.locationText).filter(Boolean))]

                return (
                  <div key={groupName}>
                    {/* Group header */}
                    <div className={`grid grid-cols-[2rem_1.5rem_1fr_6rem_4rem_4rem_4rem_2.5rem_2.5rem] gap-2 px-4 py-2.5 items-center bg-slate-50/80 hover:bg-slate-100/60 transition-colors ${groupSelected === 0 ? 'opacity-60' : ''}`}>
                      <input type="checkbox" checked={allGroupSelected} onChange={() => toggleGroupSelection(groupName)} className="mt-0.5" />
                      <button onClick={() => { toggleGroupExpand(groupName); if (isGroupEditing) setEditingGroup(null) }} className="text-slate-400 hover:text-slate-600">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => toggleGroupExpand(groupName)} className="text-left font-medium text-sm text-slate-800 truncate hover:text-slate-900">
                        {groupName}
                      </button>
                      <span className="col-span-3">
                        <span className="bg-slate-200 text-slate-600 rounded-full px-2 py-0.5 text-xs font-medium">
                          {items.length} event{items.length !== 1 ? 's' : ''}{groupSelected < items.length ? ` · ${groupSelected} sel.` : ''}
                        </span>
                      </span>
                      <span className="text-xs text-slate-400 truncate">
                        {locTexts.length === 1 ? locTexts[0] : locTexts.length > 1 ? `${locTexts.length} locations` : ''}
                      </span>
                      {/* Group settings button */}
                      <button
                        onClick={() => { setEditingGroup(isGroupEditing ? null : groupName); setEditingUid(null) }}
                        className={`p-1 rounded transition-colors ${isGroupEditing ? 'text-amber-600 bg-amber-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                        title="Edit all events in this group"
                      >
                        {isGroupEditing ? <X className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                      </button>
                      <span />
                    </div>

                    {/* Group editor */}
                    {isGroupEditing && (
                      <GroupEditor
                        groupName={groupName}
                        items={items}
                        properties={properties}
                        features={features}
                        targetGroups={targetGroups}
                        onApply={patch => updateGroup(groupName, patch)}
                        onClose={() => setEditingGroup(null)}
                      />
                    )}

                    {/* Expanded rows */}
                    {isExpanded && items.map(ev => (
                      <div key={ev.uid} className="border-t border-slate-100">
                        <div className={`grid grid-cols-[2rem_1.5rem_1fr_6rem_4rem_4rem_4rem_2.5rem_2.5rem] gap-2 px-4 py-2 items-center text-sm ${!ev.selected ? 'opacity-50' : ''} ${editingUid === ev.uid ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'}`}>
                          <input type="checkbox" checked={ev.selected} onChange={e => updateEvent(ev.uid, { selected: e.target.checked })} />
                          <span />
                          <span className="text-slate-700 text-sm truncate">{ev.name}</span>
                          <span className="text-slate-500 font-mono text-xs">{ev.date}</span>
                          <span className="text-slate-500 font-mono text-xs">{ev.timeBegin}</span>
                          <span className="text-slate-500 font-mono text-xs">
                            {ev.timeEnd}
                            <span className={`ml-1 text-xs px-1 rounded-full ${ev.isDraft ? 'bg-slate-100 text-slate-400' : 'bg-green-100 text-green-700'}`}>{ev.isDraft ? '·' : '✓'}</span>
                          </span>
                          <span className="text-slate-400 text-xs truncate" title={ev.locationText}>{ev.locationText || '—'}</span>
                          <button onClick={() => { setEditingUid(editingUid === ev.uid ? null : ev.uid); setEditingGroup(null) }}
                            className={`p-1 rounded transition-colors ${editingUid === ev.uid ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`} title="Edit this event">
                            {editingUid === ev.uid ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                          </button>
                          <span />
                        </div>
                        {editingUid === ev.uid && (
                          <RowEditor ev={ev} properties={properties} features={features} targetGroups={targetGroups}
                            onSave={patch => updateEvent(ev.uid, patch)} onClose={() => setEditingUid(null)} />
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><Check className="w-7 h-7 text-green-600" /></div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">{importedCount} events imported</h2>
          <p className="text-sm text-slate-500 mb-6">They have been added to your calendar.</p>
          <Link href={`/clubs/${clubId}/calendars/${calendarId}`}><Button>View Calendar</Button></Link>
        </div>
      )}
    </div>
  )
}
