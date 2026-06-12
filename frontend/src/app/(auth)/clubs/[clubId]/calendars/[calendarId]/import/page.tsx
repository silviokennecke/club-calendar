'use client'
import { use, useState, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { apiGet, apiPost } from '@/lib/api'
import type { Property, Feature, TargetGroup } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChevronLeft, Upload, Check } from 'lucide-react'

interface ParsedEvent {
  uid: string
  name: string
  date: string       // YYYY-MM-DD
  timeBegin: string  // HH:MM
  timeEnd: string    // HH:MM
  timezone: string | null
  isDraft: boolean
  propertyIds: number[]
  featureIds: number[]
  targetGroupIds: number[]
  selected: boolean
}

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

// ——— ICS parser ———
function parseIcs(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = []
  // Split into VEVENT blocks
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

      // Parse DTSTART — supports DATE-TIME and DATE
      const dtstart = get('DTSTART')
      if (!dtstart) continue

      let date = ''
      let timeBegin = '00:00'
      let timezone: string | null = null

      const tzMatch = block.match(/DTSTART;TZID=([^:]+):/i)
      if (tzMatch) timezone = tzMatch[1].trim()

      if (dtstart.length >= 8) {
        const y = dtstart.slice(0, 4)
        const m = dtstart.slice(4, 6)
        const d = dtstart.slice(6, 8)
        date = `${y}-${m}-${d}`
        if (dtstart.length >= 13) {
          const h = dtstart.slice(9, 11)
          const min = dtstart.slice(11, 13)
          timeBegin = `${h}:${min}`
        }
      }
      if (!date) continue

      const dtend = get('DTEND')
      let timeEnd = timeBegin
      if (dtend && dtend.length >= 13) {
        const endDate = dtend.slice(0, 8)
        const y = endDate.slice(0, 4), mo = endDate.slice(4, 6), dy = endDate.slice(6, 8)
        const endDateStr = `${y}-${mo}-${dy}`
        // Only use end time if same day
        if (endDateStr === date) {
          timeEnd = `${dtend.slice(9, 11)}:${dtend.slice(11, 13)}`
        }
      }

      events.push({
        uid,
        name: summary,
        date,
        timeBegin,
        timeEnd,
        timezone,
        isDraft: true,
        propertyIds: [],
        featureIds: [],
        targetGroupIds: [],
        selected: true,
      })
    } catch { /* skip malformed events */ }
  }
  return events
}

export default function ImportPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [events, setEvents] = useState<ParsedEvent[]>([])
  const [importing, setImporting] = useState(false)
  const [importedCount, setImportedCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const { data: properties = [] } = useQuery<Property[]>({ queryKey: ['properties', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/properties`), enabled: step === 'review' })
  const { data: features = [] } = useQuery<Feature[]>({ queryKey: ['features', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/features`), enabled: step === 'review' })
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({ queryKey: ['targetGroups', calendarId], queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`), enabled: step === 'review' })

  function handleFile(file: File) {
    if (!file.name.endsWith('.ics') && file.type !== 'text/calendar') {
      alert('Please select an .ics file')
      return
    }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseIcs(text)
      if (parsed.length === 0) { alert('No events found in this ICS file'); return }
      setEvents(parsed)
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

  const selectedEvents = events.filter(e => e.selected)
  const allSelected = events.length > 0 && selectedEvents.length === events.length

  function toggleAll() {
    const next = !allSelected
    setEvents(prev => prev.map(e => ({ ...e, selected: next })))
  }

  function bulkSetDraft(isDraft: boolean) {
    setEvents(prev => prev.map(e => e.selected ? { ...e, isDraft } : e))
  }

  function bulkToggleProperty(id: number) {
    const allHave = selectedEvents.every(e => e.propertyIds.includes(id))
    setEvents(prev => prev.map(e => {
      if (!e.selected) return e
      return { ...e, propertyIds: allHave ? e.propertyIds.filter(x => x !== id) : [...new Set([...e.propertyIds, id])] }
    }))
  }

  function bulkToggleFeature(id: number) {
    const allHave = selectedEvents.every(e => e.featureIds.includes(id))
    setEvents(prev => prev.map(e => {
      if (!e.selected) return e
      return { ...e, featureIds: allHave ? e.featureIds.filter(x => x !== id) : [...new Set([...e.featureIds, id])] }
    }))
  }

  function bulkToggleTargetGroup(id: number) {
    const allHave = selectedEvents.every(e => e.targetGroupIds.includes(id))
    setEvents(prev => prev.map(e => {
      if (!e.selected) return e
      return { ...e, targetGroupIds: allHave ? e.targetGroupIds.filter(x => x !== id) : [...new Set([...e.targetGroupIds, id])] }
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
      setImporting(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-slate-400 hover:text-slate-600">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-base font-semibold text-slate-900">Import Events from ICS</h1>
      </div>

      {/* Step: Upload */}
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

      {/* Step: Review */}
      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">{events.length}</span> events parsed · <span className="font-semibold">{selectedEvents.length}</span> selected
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
                    const allHave = selectedEvents.length > 0 && selectedEvents.every(e => e.targetGroupIds.includes(tg.id))
                    return (
                      <button key={tg.id} onClick={() => bulkToggleTargetGroup(tg.id)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-purple-200'}`}>
                        {tg.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {properties.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 w-20">Properties</span>
                  {properties.map(p => {
                    const allHave = selectedEvents.length > 0 && selectedEvents.every(e => e.propertyIds.includes(p.id))
                    return (
                      <button key={p.id} onClick={() => bulkToggleProperty(p.id)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:border-blue-200'}`}>
                        {p.icon && <span className="mr-1">{p.icon}</span>}{p.name}
                      </button>
                    )
                  })}
                </div>
              )}

              {features.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-slate-500 w-20">Features</span>
                  {features.map(f => {
                    const allHave = selectedEvents.length > 0 && selectedEvents.every(e => e.featureIds.includes(f.id))
                    return (
                      <button key={f.id} onClick={() => bulkToggleFeature(f.id)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${allHave ? 'bg-green-100 border-green-300 text-green-700' : 'border-slate-200 text-slate-600 hover:border-green-200'}`}>
                        {f.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Events table */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2rem_1fr_7rem_5rem_5rem_5rem] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="mt-0.5" />
              <span>Name</span>
              <span>Date</span>
              <span>Start</span>
              <span>End</span>
              <span>Status</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-slate-100 max-h-[50vh] overflow-y-auto">
              {events.map(ev => (
                <div key={ev.uid} className={`grid grid-cols-[2rem_1fr_7rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-sm ${!ev.selected ? 'opacity-50' : ''}`}>
                  <input type="checkbox" checked={ev.selected} onChange={e => updateEvent(ev.uid, { selected: e.target.checked })} />
                  <Input
                    value={ev.name}
                    onChange={e => updateEvent(ev.uid, { name: e.target.value })}
                    className="h-7 text-sm border-0 bg-transparent p-0 focus:bg-white focus:border focus:px-2 focus:rounded transition-all"
                  />
                  <span className="text-slate-600 font-mono text-xs">{ev.date}</span>
                  <span className="text-slate-600 font-mono text-xs">{ev.timeBegin}</span>
                  <span className="text-slate-600 font-mono text-xs">{ev.timeEnd}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${ev.isDraft ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-700'}`}>
                    {ev.isDraft ? 'Draft' : 'Published'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step: Done */}
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
