'use client'
import { use, useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiDelete } from '@/lib/api'
import type { CalendarEvent, TargetGroup } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/dateFormat'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import EventModal from '@/components/calendar/EventModal'
import { Search, X, Eye, EyeOff, CheckSquare, Trash2 } from 'lucide-react'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

type StatusFilter = 'all' | 'draft' | 'published'

export default function EventsListPage({ params }: Props) {
  const { calendarId } = use(params)
  const qc = useQueryClient()
  const { user } = useAuth()
  const dateFormat = user?.dateFormat ?? 'dd.MM.yyyy'

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulking, setBulking] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)

  const { data: allEvents = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ['events-list', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/events`),
  })
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ['targetGroups', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  })

  // Filter + search
  const filtered = useMemo(() => {
    let list = allEvents
    if (statusFilter === 'draft') list = list.filter(e => e.isDraft)
    else if (statusFilter === 'published') list = list.filter(e => !e.isDraft)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e => e.name.toLowerCase().includes(q))
    }
    return list
  }, [allEvents, statusFilter, search])

  // Sort by date asc
  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    return d !== 0 ? d : a.timeBegin.localeCompare(b.timeBegin)
  }), [filtered])

  const allFilteredSelected = sorted.length > 0 && sorted.every(e => selectedIds.has(e.id))
  const someSelected = selectedIds.size > 0

  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const next = new Set(prev); sorted.forEach(e => next.delete(e.id)); return next })
    } else {
      setSelectedIds(prev => { const next = new Set(prev); sorted.forEach(e => next.add(e.id)); return next })
    }
  }

  async function bulkDelete() {
    const ids = sorted.filter(e => selectedIds.has(e.id)).map(e => e.id)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} event${ids.length !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulking(true)
    try {
      await Promise.all(ids.map(id => apiDelete(`/api/calendars/${calendarId}/events/${id}`)))
      qc.invalidateQueries({ queryKey: ['events-list', calendarId] })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      setSelectedIds(new Set())
    } finally { setBulking(false) }
  }

  async function bulkSetDraft(isDraft: boolean) {
    const ids = sorted.filter(e => selectedIds.has(e.id)).map(e => e.id)
    if (ids.length === 0) return
    setBulking(true)
    try {
      await Promise.all(ids.map(id => apiPatch(`/api/calendars/${calendarId}/events/${id}`, { isDraft })))
      qc.invalidateQueries({ queryKey: ['events-list', calendarId] })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
      setSelectedIds(new Set())
    } finally { setBulking(false) }
  }

  const draftCount = allEvents.filter(e => e.isDraft).length
  const publishedCount = allEvents.filter(e => !e.isDraft).length

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900">Events</h1>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
            className="pl-8 pr-7 h-8 w-48 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
        {([['all', `All (${allEvents.length})`], ['published', `Published (${publishedCount})`], ['draft', `Draft (${draftCount})`]] as [StatusFilter, string][]).map(([val, label]) => (
          <button key={val} onClick={() => { setStatusFilter(val); setSelectedIds(new Set()) }}
            className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${statusFilter === val ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Bulk action bar — appears when something is selected */}
      {someSelected && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
          <span className="text-sm font-medium text-blue-800">{selectedIds.size} selected</span>
          <div className="flex gap-2 ml-auto">
            <Button size="sm" variant="outline" disabled={bulking} onClick={() => bulkSetDraft(false)}
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50">
              <Eye className="w-3.5 h-3.5" />Publish
            </Button>
            <Button size="sm" variant="outline" disabled={bulking} onClick={() => bulkSetDraft(true)}
              className="gap-1.5 border-slate-300 text-slate-600 hover:bg-slate-50">
              <EyeOff className="w-3.5 h-3.5" />Mark as draft
            </Button>
            <Button size="sm" variant="outline" disabled={bulking} onClick={bulkDelete}
              className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} className="text-slate-400">
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          {search ? 'No events match your search.' : statusFilter !== 'all' ? `No ${statusFilter} events.` : 'No events yet.'}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2rem_1fr_7rem_5rem_5rem_auto_5.5rem] gap-3 px-4 py-2 bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-500">
            <button onClick={toggleAll} className={`flex items-center justify-center ${allFilteredSelected ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
              <CheckSquare className="w-4 h-4" />
            </button>
            <span>Name</span>
            <span>Date</span>
            <span>Start</span>
            <span>End</span>
            <span>Tags</span>
            <span>Status</span>
          </div>

          <div className="divide-y divide-slate-100">
            {sorted.map(ev => {
              const isSel = selectedIds.has(ev.id)
              const iconPrefix = ev.properties.map(p => p.property.icon).filter(Boolean).join('')
              const tgNames = ev.targetGroups.map(t => t.targetGroup.name)

              return (
                <div key={ev.id}
                  className={`grid grid-cols-[2rem_1fr_7rem_5rem_5rem_auto_5.5rem] gap-3 px-4 py-2.5 items-center text-sm cursor-pointer transition-colors ${isSel ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}
                  onClick={() => setEditingEvent(ev)}
                >
                  {/* Checkbox — stop propagation so clicking it doesn't open the modal */}
                  <div onClick={e => { e.stopPropagation(); toggleSelect(ev.id) }}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer ${isSel ? 'bg-blue-600 border-blue-600' : 'border-slate-300 hover:border-blue-400'}`}>
                    {isSel && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>

                  <span className="font-medium text-slate-800 truncate">
                    {iconPrefix && <span className="mr-1">{iconPrefix}</span>}
                    {ev.name}
                    {ev.location && <span className="ml-1.5 text-slate-400 font-normal text-xs">@ {ev.location.name ?? ev.location.address}</span>}
                  </span>
                  <span className="text-slate-500 text-xs">
                    {ev.dateEnd && ev.dateEnd.slice(0, 10) !== ev.date.slice(0, 10)
                      ? `${formatDate(ev.date, dateFormat)} – ${formatDate(ev.dateEnd, dateFormat)}`
                      : formatDate(ev.date, dateFormat)}
                  </span>
                  <span className="text-slate-500 font-mono text-xs">{ev.isAllDay ? '—' : ev.timeBegin}</span>
                  <span className="text-slate-500 font-mono text-xs">{ev.isAllDay ? 'All day' : ev.timeEnd}</span>

                  {/* Tags: target groups + features */}
                  <div className="flex gap-1 flex-wrap">
                    {tgNames.map(n => (
                      <span key={n} className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-full">{n}</span>
                    ))}
                    {ev.features.map(f => (
                      <span key={f.feature.id} className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">{f.feature.name}</span>
                    ))}
                  </div>

                  <span className={`justify-self-start text-xs px-2 py-0.5 rounded-full font-medium ${ev.isDraft ? 'bg-slate-100 text-slate-500' : 'bg-green-100 text-green-700'}`}>
                    {ev.isDraft ? 'Draft' : 'Published'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Row count */}
      {sorted.length > 0 && (
        <p className="text-xs text-slate-400 mt-3">{sorted.length} event{sorted.length !== 1 ? 's' : ''}{search || statusFilter !== 'all' ? ' (filtered)' : ''}</p>
      )}

      {/* Edit modal */}
      <EventModal
        calendarId={calendarId}
        open={editingEvent !== null}
        onClose={() => { setEditingEvent(null); qc.invalidateQueries({ queryKey: ['events-list', calendarId] }) }}
        event={editingEvent}
      />
    </div>
  )
}

// Mini check icon used inline
function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
