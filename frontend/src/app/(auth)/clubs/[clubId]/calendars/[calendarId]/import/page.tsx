'use client'
import { use, useState, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiGet, apiPost } from '@/lib/api'
import type { Property, Feature, TargetGroup } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, ChevronDown, Upload, Check, Pencil, X } from 'lucide-react'

interface ParsedEvent {
  uid: string
  name: string
  date: string
  timeBegin: string
  timeEnd: string
  timezone: string | null
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
      events.push({ uid, name: summary, date, timeBegin, timeEnd, timezone, isDraft: true, propertyIds: [], featureIds: [], targetGroupIds: [], selected: true })
    } catch { /* skip malformed */ }
  }
  return events
}

// ——— Per-row inline editor ———
interface RowEditorProps {
  ev: ParsedEvent
  properties: Property[]
  features: Feature[]
  targetGroups: TargetGroup[]
  onSave: (patch: Partial<ParsedEvent>) => void
  onClose: () => void
}

function RowEditor({ ev, properties, features, targetGroups, onSave, onClose }: RowEditorProps) {
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
        <div className="space-y-1 flex-1 min-w-40">
          <Label className="text-xs">Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1 min-w-36">
          <Label className="text-xs">Date</Label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-full" />
        </div>
        <div className="space-y-1 min-w-28">
          <Label className="text-xs">Start</Label>
          <Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="h-8 text-sm w-full" />
        </div>
        <div className="space-y-1 min-w-28">
          <Label className="text-xs">End</Label>
          <Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="h-8 text-sm w-full" />
        </div>
        <div className="space-y-1 flex items-end pb-0.5 gap-2">
          <Switch id={`draft-${ev.uid}`} checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} />
          <Label htmlFor={`draft-${ev.uid}`} className="text-xs">Published</Label>
        </div>
      </div>

      {targetGroups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 w-16">Groups</span>
          {targetGroups.map(tg => (
            <button key={tg.id} type="button" onClick={() => setTargetGroupIds(toggle(targetGroupIds, tg.id))}
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
            <button key={p.id} type="button" onClick={() => setPropertyIds(toggle(propertyIds, p.id))}
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
            <button key={f.id} type="button" onClick={() => setFeatureIds(toggle(featureIds, f.id))}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${featureIds.includes(f.id) ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-green-200'}`}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onSave({ name, date, timeBegin, timeEnd, isDraft, propertyIds, featureIds, targetGroupIds }); onClose() }}>
          <Check className="w-3.5 h-3.5 mr-1" />Apply
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

  const { data: properties = [] } = useQuery<Property[]>({ queryKey: ['properties', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/properties`), enabled: step === 'review' })
  const { data: features = [] } = useQuery<Feature[]>({ queryKey: ['features', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/features`), enabled: step === 'review' })
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`), enabled: step === 'review' })

  // Group events by name, preserving insertion order of first occurrence
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
      // Collapse all groups initially — user expands what they need
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

  function toggleGroup(name: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  function toggleGroupSelection(groupName: string) {
    const groupItems = events.filter(e => e.name === groupName)
    const allSelected = groupItems.every(e => e.selected)
    setEvents(prev => prev.map(e => e.name === groupName ? { ...e, selected: !allSelected } : e))
  }

  const selectedEvents = events.filter(e => e.selected)
  const allSelected = events.length > 0 && selectedEvents.length === events.length

  function toggleAll() {
    const next = !allSelected
    setEvents(prev => prev.map(e => ({ ...e, selected: next })))
  }

  function bulkSetDraft(isDraft: boolean) {
    setEvents(prev => prev.map(e => e.selected ? { ...e, isDraft } : e))
  }

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
      const result = await apiPost<{ imported: number }>(
        `/api/calendars/${calendarId}/events/import`,
        { events: toImport.map(({ uid: _uid, selected: _s, ...rest }) => rest) }
      )
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      setImportedCount(result.imported)
      setStep('done')
    } catch (e) {
      alert((e as Error).message ?? 'Import failed')
    } finally {
      setImporting(false) }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-slate-400 hover:text-slate-600">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-semibold text-slate-900">Import Events from ICS</h1>
      </div>

      {/* Upload */}
      {step === 'upload' && (
        <div
          className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Drop an ICS file here</p>
          <p className="text-sm text-slate-400 mt-1">or click to browse</p>
          <input ref={fileInputRef} type="file" accept=".ics,text/calendar" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
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

          {/* Bulk actions */}
          {selectedEvents.length > 0 && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Bulk assign to {selectedEvents.length} selected</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">Status</span>
                <button onClick={() => bulkSetDraft(false)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">Published</button>
                <button onClick={() => bulkSetDraft(true)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-slate-300 transition-colors">Draft</button>
              </div>
              {targetGroups.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 w-20">Groups</span>
                  {targetGroups.map(tg => {
                    const allHave = selectedEvents.every(e => e.targetGroupIds.includes(tg.id))
                    return <button key={tg.id} onClick={() => bulkToggleIds('targetGroupIds', tg.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-purple-200'}`}>{tg.name}</button>
                  })}
                </div>
              )}
              {properties.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 w-20">Properties</span>
                  {properties.map(p => {
                    const allHave = selectedEvents.every(e => e.propertyIds.includes(p.id))
                    return <button key={p.id} onClick={() => bulkToggleIds('propertyIds', p.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-200'}`}>
                      {p.icon && <span className="mr-1">{p.icon}</span>}{p.name}</button>
                  })}
                </div>
              )}
              {features.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 w-20">Features</span>
                  {features.map(f => {
                    const allHave = selectedEvents.every(e => e.featureIds.includes(f.id))
                    return <button key={f.id} onClick={() => bulkToggleIds('featureIds', f.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-green-200'}`}>{f.name}</button>
                  })}
                </div>
              )}
            </div>
          )}

          {/* Grouped table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[2rem_1.5rem_1fr_7rem_5rem_5rem_2.5rem] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="mt-0.5" />
              <span />
              <span>Name</span>
              <span>Date</span>
              <span>Start</span>
              <span>End</span>
              <span />
            </div>

            <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {groups.map(({ name: groupName, items }) => {
                const isExpanded = expandedGroups.has(groupName)
                const groupSelected = items.filter(e => e.selected).length
                const allGroupSelected = groupSelected === items.length

                return (
                  <div key={groupName}>
                    {/* Group header */}
                    <div className={`grid grid-cols-[2rem_1.5rem_1fr_7rem_5rem_5rem_2.5rem] gap-2 px-4 py-2.5 items-center bg-slate-50/80 hover:bg-slate-100/60 transition-colors ${groupSelected === 0 ? 'opacity-60' : ''}`}>
                      <input type="checkbox" checked={allGroupSelected} onChange={() => toggleGroupSelection(groupName)} className="mt-0.5" />
                      <button onClick={() => toggleGroup(groupName)} className="text-slate-400 hover:text-slate-600 flex items-center justify-center">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => toggleGroup(groupName)} className="text-left font-medium text-sm text-slate-800 truncate hover:text-slate-900">
                        {groupName}
                      </button>
                      <span className="text-xs text-slate-400 col-span-3">
                        <span className="bg-slate-200 text-slate-600 rounded-full px-2 py-0.5 text-xs font-medium">
                          {items.length} event{items.length !== 1 ? 's' : ''}
                          {groupSelected < items.length ? ` · ${groupSelected} selected` : ''}
                        </span>
                      </span>
                      <span />
                    </div>

                    {/* Expanded rows */}
                    {isExpanded && items.map(ev => (
                      <div key={ev.uid} className="border-t border-slate-100">
                        <div className={`grid grid-cols-[2rem_1.5rem_1fr_7rem_5rem_5rem_2.5rem] gap-2 px-4 py-2 items-center text-sm ${!ev.selected ? 'opacity-50' : ''} ${editingUid === ev.uid ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'}`}>
                          <input type="checkbox" checked={ev.selected} onChange={e => updateEvent(ev.uid, { selected: e.target.checked })} />
                          <span /> {/* indent */}
                          <span className="text-slate-700 text-sm truncate">{ev.name}</span>
                          <span className="text-slate-500 font-mono text-xs">{ev.date}</span>
                          <span className="text-slate-500 font-mono text-xs">{ev.timeBegin}</span>
                          <span className="text-slate-500 font-mono text-xs">
                            {ev.timeEnd}
                            <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${ev.isDraft ? 'bg-slate-100 text-slate-400' : 'bg-green-100 text-green-700'}`}>
                              {ev.isDraft ? '·' : '✓'}
                            </span>
                          </span>
                          <button
                            onClick={() => setEditingUid(editingUid === ev.uid ? null : ev.uid)}
                            className={`p-1 rounded transition-colors ${editingUid === ev.uid ? 'text-blue-600 bg-blue-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                            title="Edit this event"
                          >
                            {editingUid === ev.uid ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {editingUid === ev.uid && (
                          <RowEditor
                            ev={ev}
                            properties={properties}
                            features={features}
                            targetGroups={targetGroups}
                            onSave={patch => updateEvent(ev.uid, patch)}
                            onClose={() => setEditingUid(null)}
                          />
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
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check className="w-7 h-7 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">{importedCount} events imported</h2>
          <p className="text-sm text-slate-500 mb-6">They have been added to your calendar.</p>
          <Link href={`/clubs/${clubId}/calendars/${calendarId}`}>
            <Button>View Calendar</Button>
          </Link>
        </div>
      )}
    </div>
  )
}
