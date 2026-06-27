import { useState, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  dateEnd: string
  timeBegin: string
  timeEnd: string
  timezone: string | null
  locationText: string
  isAllDay: boolean
  isDraft: boolean
  propertyIds: string[]
  featureIds: string[]
  targetGroupIds: string[]
  selected: boolean
}

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
      }
      if (!date) continue
      const isAllDay = dtstart.length === 8
      if (!isAllDay && dtstart.length >= 13) {
        timeBegin = `${dtstart.slice(9, 11)}:${dtstart.slice(11, 13)}`
      }
      const dtend = get('DTEND')
      let timeEnd = timeBegin
      let dateEnd = ''

      if (dtend) {
        const dtendDate = `${dtend.slice(0, 4)}-${dtend.slice(4, 6)}-${dtend.slice(6, 8)}`
        if (isAllDay) {
          const dtendParsed = new Date(dtendDate)
          dtendParsed.setDate(dtendParsed.getDate() - 1)
          const dtendAdjusted = dtendParsed.toISOString().slice(0, 10)
          if (dtendAdjusted !== date) dateEnd = dtendAdjusted
        } else if (dtend.length >= 13) {
          if (dtendDate !== date) {
            dateEnd = dtendDate
          }
          timeEnd = `${dtend.slice(9, 11)}:${dtend.slice(11, 13)}`
        }
      }
      const locationText = get('LOCATION').replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\/g, '')
      events.push({ uid, name: summary, date, dateEnd, timeBegin, timeEnd, timezone, locationText, isDraft: true, isAllDay, propertyIds: [], featureIds: [], targetGroupIds: [], selected: true })
    } catch { /* skip malformed */ }
  }
  return events
}

function RelationFields({ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds, onToggleProp, onToggleFeat, onToggleTg }: {
  properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  propertyIds: string[]; featureIds: string[]; targetGroupIds: string[]
  onToggleProp: (id: string) => void; onToggleFeat: (id: string) => void; onToggleTg: (id: string) => void
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

function RowEditor({ ev, properties, features, targetGroups, onSave, onClose }: {
  ev: ParsedEvent; properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  onSave: (patch: Partial<ParsedEvent>) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(ev.name)
  const [date, setDate] = useState(ev.date)
  const [dateEnd, setDateEnd] = useState(ev.dateEnd)
  const [timeBegin, setTimeBegin] = useState(ev.timeBegin)
  const [timeEnd, setTimeEnd] = useState(ev.timeEnd)
  const [isDraft, setIsDraft] = useState(ev.isDraft)
  const [isAllDay, setIsAllDay] = useState(ev.isAllDay)
  const [propertyIds, setPropertyIds] = useState(ev.propertyIds)
  const [featureIds, setFeatureIds] = useState(ev.featureIds)
  const [targetGroupIds, setTargetGroupIds] = useState(ev.targetGroupIds)
  function toggle<T>(arr: T[], val: T) { return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }
  return (
    <div className="px-4 py-3 bg-blue-50/60 border-t border-blue-100 space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1 flex-1 min-w-40"><Label className="text-xs">{t('import.name')}</Label><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" /></div>
        <div className="space-y-1 min-w-36"><Label className="text-xs">{t('import.date')}</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm w-full" /></div>
        <div className="space-y-1 min-w-36">
          <Label className="text-xs">{t('eventModal.endDate')}</Label>
          <Input type="date" value={dateEnd} className="h-8 text-sm w-full" onChange={e => setDateEnd(e.target.value)} />
        </div>
        <div className="flex items-end pb-0.5 gap-2">
          <Switch id={`allday-${ev.uid}`} checked={isAllDay} onCheckedChange={setIsAllDay} />
          <Label htmlFor={`allday-${ev.uid}`} className="text-xs">{t('eventModal.allDay')}</Label>
        </div>
        {!isAllDay && (
          <>
            <div className="space-y-1 min-w-28"><Label className="text-xs">{t('import.start')}</Label><Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="h-8 text-sm w-full" /></div>
            <div className="space-y-1 min-w-28"><Label className="text-xs">{t('import.end')}</Label><Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="h-8 text-sm w-full" /></div>
          </>
        )}
        <div className="flex items-end pb-0.5 gap-2"><Switch id={`d-${ev.uid}`} checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} /><Label htmlFor={`d-${ev.uid}`} className="text-xs">{t('common.published')}</Label></div>
      </div>
      <RelationFields {...{ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds }}
        onToggleProp={id => setPropertyIds(toggle(propertyIds, id))}
        onToggleFeat={id => setFeatureIds(toggle(featureIds, id))}
        onToggleTg={id => setTargetGroupIds(toggle(targetGroupIds, id))} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onSave({ name, date, dateEnd, timeBegin, timeEnd, isDraft, isAllDay, propertyIds, featureIds, targetGroupIds }); onClose() }}><Check className="w-3.5 h-3.5 mr-1" />{t('common.apply')}</Button>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="w-3.5 h-3.5 mr-1" />{t('common.cancel')}</Button>
      </div>
    </div>
  )
}

function GroupEditor({ groupName, items, properties, features, targetGroups, onApply, onClose }: {
  groupName: string; items: ParsedEvent[]
  properties: Property[]; features: Feature[]; targetGroups: TargetGroup[]
  onApply: (patch: Partial<ParsedEvent>) => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const first = items[0]
  const [name, setName] = useState(groupName)
  const [timeBegin, setTimeBegin] = useState(first.timeBegin)
  const [timeEnd, setTimeEnd] = useState(first.timeEnd)
  const [isDraft, setIsDraft] = useState(first.isDraft)
  const [isAllDay, setIsAllDay] = useState(first.isAllDay)
  const [propertyIds, setPropertyIds] = useState<string[]>(
    first.propertyIds.filter(id => items.every(e => e.propertyIds.includes(id)))
  )
  const [featureIds, setFeatureIds] = useState<string[]>(
    first.featureIds.filter(id => items.every(e => e.featureIds.includes(id)))
  )
  const [targetGroupIds, setTargetGroupIds] = useState<string[]>(
    first.targetGroupIds.filter(id => items.every(e => e.targetGroupIds.includes(id)))
  )
  function toggle<T>(arr: T[], val: T) { return arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] }
  return (
    <div className="px-4 py-4 bg-amber-50/60 border-b border-amber-200 space-y-3">
      <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">{t('import.editAllInGroup', { count: items.length })}</p>
      <div className="flex flex-wrap gap-2">
        <div className="space-y-1 flex-1 min-w-40"><Label className="text-xs">{t('import.renameAll')}</Label><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" /></div>
        <div className="flex items-end pb-0.5 gap-2">
          <Switch id={`gallday-${groupName}`} checked={isAllDay} onCheckedChange={setIsAllDay} />
          <Label htmlFor={`gallday-${groupName}`} className="text-xs">{t('eventModal.allDay')}</Label>
        </div>
        {!isAllDay && (
          <>
            <div className="space-y-1 min-w-28"><Label className="text-xs">{t('import.startAll')}</Label><Input type="time" value={timeBegin} onChange={e => setTimeBegin(e.target.value)} className="h-8 text-sm w-full" /></div>
            <div className="space-y-1 min-w-28"><Label className="text-xs">{t('import.endAll')}</Label><Input type="time" value={timeEnd} onChange={e => setTimeEnd(e.target.value)} className="h-8 text-sm w-full" /></div>
          </>
        )}
        <div className="flex items-end pb-0.5 gap-2"><Switch id={`gd-${groupName}`} checked={!isDraft} onCheckedChange={v => setIsDraft(!v)} /><Label htmlFor={`gd-${groupName}`} className="text-xs">{t('common.published')}</Label></div>
      </div>
      <RelationFields {...{ properties, features, targetGroups, propertyIds, featureIds, targetGroupIds }}
        onToggleProp={id => setPropertyIds(toggle(propertyIds, id))}
        onToggleFeat={id => setFeatureIds(toggle(featureIds, id))}
        onToggleTg={id => setTargetGroupIds(toggle(targetGroupIds, id))} />
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={() => { onApply({ name, timeBegin, timeEnd, isDraft, isAllDay, propertyIds, featureIds, targetGroupIds }); onClose() }}>
          <Check className="w-3.5 h-3.5 mr-1" />{t('import.applyToAll', { count: items.length })}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}><X className="w-3.5 h-3.5 mr-1" />{t('common.cancel')}</Button>
      </div>
    </div>
  )
}

export default function ImportPage() {
  const { t } = useTranslation()
  const { clubId, calendarId } = useParams<{ clubId: string; calendarId: string }>()
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
    if (!file.name.endsWith('.ics') && file.type !== 'text/calendar') { alert(t('import.invalidFile')); return }
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const parsed = parseIcs(text)
      if (parsed.length === 0) { alert(t('import.noEventsFound')); return }
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
  function bulkToggleIds(field: 'propertyIds' | 'featureIds' | 'targetGroupIds', id: string) {
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
      const uniqueTexts = [...new Set(toImport.map(e => e.locationText).filter(Boolean))]
      const locationIdMap = new Map<string, string>()
      for (const text of uniqueTexts) {
        const existing = locations.find(l => (l.street ?? '').toLowerCase() === text.toLowerCase())
        if (existing) {
          locationIdMap.set(text, existing.id)
        } else {
          const created = await apiPost<Location>(`/api/calendars/${calendarId}/locations`, { street: text })
          locationIdMap.set(text, created.id)
        }
      }
      const result = await apiPost<{ imported: number }>(
        `/api/calendars/${calendarId}/events/import`,
        {
          events: toImport.map(({ uid: _uid, selected: _s, locationText, ...rest }) => ({
            ...rest,
            dateEnd: rest.dateEnd || null,
            locationId: locationText ? (locationIdMap.get(locationText) ?? null) : null,
          }))
        }
      )
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      qc.invalidateQueries({ queryKey: ['locations', calendarId] })
      setImportedCount(result.imported)
      setStep('done')
    } catch (e) {
      alert((e as Error).message ?? t('import.importFailed'))
    } finally { setImporting(false) }
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/clubs/${clubId}/calendars/${calendarId}`} className="text-slate-400 hover:text-slate-600"><ChevronLeft className="w-4 h-4" /></Link>
        <h1 className="text-base font-semibold text-slate-900">{t('import.title')}</h1>
      </div>

      {step === 'upload' && (
        <div className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop} onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">{t('import.dropFile')}</p>
          <p className="text-sm text-slate-400 mt-1">{t('import.orClick')}</p>
          <input ref={fileInputRef} type="file" accept=".ics,text/calendar" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              <span className="font-semibold">{events.length}</span>{' '}
              {t('import.eventsCount', { events: events.length, groups: groups.length, selected: selectedEvents.length })}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setStep('upload'); setEvents([]) }}>{t('import.back')}</Button>
              <Button size="sm" disabled={importing || selectedEvents.length === 0} onClick={handleImport}>
                {importing ? t('import.importing') : t('import.importCount', { count: selectedEvents.length })}
              </Button>
            </div>
          </div>

          {selectedEvents.length > 0 && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{t('import.bulkAssign', { count: selectedEvents.length })}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">{t('import.status')}</span>
                <button onClick={() => bulkSetDraft(false)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">{t('common.published')}</button>
                <button onClick={() => bulkSetDraft(true)} className="text-xs px-2.5 py-1 rounded-full border border-slate-200 hover:border-slate-300 transition-colors">{t('common.draft')}</button>
              </div>
              {targetGroups.length > 0 && <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-500 w-20">{t('import.groups')}</span>
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

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="grid grid-cols-[2rem_1.5rem_1fr_6rem_4rem_4rem_4rem_2.5rem_2.5rem] gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="mt-0.5" />
              <span />
              <span>{t('import.name')}</span>
              <span>{t('import.date')}</span>
              <span>{t('import.start')}</span>
              <span>{t('import.end')}</span>
              <span>{t('import.location')}</span>
              <span />
              <span />
            </div>

            <div className="divide-y divide-slate-100 max-h-[55vh] overflow-y-auto">
              {groups.map(({ name: groupName, items }) => {
                const isExpanded = expandedGroups.has(groupName)
                const groupSelected = items.filter(e => e.selected).length
                const allGroupSelected = groupSelected === items.length
                const isGroupEditing = editingGroup === groupName
                const locTexts = [...new Set(items.map(e => e.locationText).filter(Boolean))]

                return (
                  <div key={groupName}>
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
                        {locTexts.length === 1 ? locTexts[0] : locTexts.length > 1 ? t('import.locationCount', { count: locTexts.length }) : ''}
                      </span>
                      <button
                        onClick={() => { setEditingGroup(isGroupEditing ? null : groupName); setEditingUid(null) }}
                        className={`p-1 rounded transition-colors ${isGroupEditing ? 'text-amber-600 bg-amber-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                        title="Edit all events in this group"
                      >
                        {isGroupEditing ? <X className="w-3.5 h-3.5" /> : <Settings2 className="w-3.5 h-3.5" />}
                      </button>
                      <span />
                    </div>

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

                    {isExpanded && items.map(ev => (
                      <div key={ev.uid} className="border-t border-slate-100">
                        <div className={`grid grid-cols-[2rem_1.5rem_1fr_6rem_4rem_4rem_4rem_2.5rem_2.5rem] gap-2 px-4 py-2 items-center text-sm ${!ev.selected ? 'opacity-50' : ''} ${editingUid === ev.uid ? 'bg-blue-50/40' : 'hover:bg-slate-50/50'}`}>
                          <input type="checkbox" checked={ev.selected} onChange={e => updateEvent(ev.uid, { selected: e.target.checked })} />
                          <span />
                          <span className="text-slate-700 text-sm truncate">{ev.name}</span>
                          <span className="text-slate-500 font-mono text-xs">
                            {ev.dateEnd ? `${ev.date} – ${ev.dateEnd}` : ev.date}
                          </span>
                          <span className="text-slate-500 font-mono text-xs">{ev.isAllDay ? '—' : ev.timeBegin}</span>
                          <span className="text-slate-500 font-mono text-xs">
                            {ev.isAllDay ? t('import.allDay') : ev.timeEnd}
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

      {step === 'done' && (
        <div className="text-center py-16">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><Check className="w-7 h-7 text-green-600" /></div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">{t('import.importedSuccess', { count: importedCount })}</h2>
          <p className="text-sm text-slate-500 mb-6">{t('import.addedToCalendar')}</p>
          <Link to={`/clubs/${clubId}/calendars/${calendarId}`}><Button>{t('import.viewCalendar')}</Button></Link>
        </div>
      )}
    </div>
  )
}
