'use client'
import { use, useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventClickArg, EventDropArg } from '@fullcalendar/core'
import type { DateClickArg } from '@fullcalendar/interaction'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import type { CalendarEvent, TargetGroup, Calendar } from '@/lib/types'
import { useAuth } from '@/lib/auth-context'
import { Button } from '@/components/ui/button'
import EventModal from '@/components/calendar/EventModal'
import Link from 'next/link'
import { Plus, Upload, Search, X, ArchiveRestore } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function CalendarPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const qc = useQueryClient()
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<number[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  // Refs keep latest filter values accessible inside the stale fetchEvents closure
  const selectedGroupsRef = useRef<number[]>([])
  const searchQueryRef = useRef('')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null)

  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ['targetGroups', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  })

  const { data: calendar, refetch: refetchCalendar } = useQuery<Calendar>({
    queryKey: ['calendar', clubId, calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  })

  const isArchived = !!calendar?.archivedAt

  async function handleUnarchive() {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {})
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
    refetchCalendar()
  }

  function toggleGroup(id: number) {
    setSelectedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      selectedGroupsRef.current = next
      setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0)
      return next
    })
  }

  function clearFilter() {
    selectedGroupsRef.current = []
    setSelectedGroups([])
    setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0)
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value)
    searchQueryRef.current = value
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 300)
  }

  function clearSearch() {
    searchQueryRef.current = ''
    setSearchQuery('')
    calendarRef.current?.getApi().refetchEvents()
  }

  function openCreate(date?: string) {
    setEditingEvent(null)
    setSelectedDate(date)
    setModalOpen(true)
  }

  function openEdit(event: CalendarEvent) {
    setSelectedDate(undefined)
    setEditingEvent(event)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingEvent(null)
    setSelectedDate(undefined)
  }

  function fetchEvents(
    fetchInfo: { startStr: string; endStr: string },
    successCallback: (events: EventInput[]) => void,
    failureCallback: (err: Error) => void,
  ) {
    const tgParam = selectedGroupsRef.current.length > 0 ? `&targetGroupIds=${selectedGroupsRef.current.join(',')}` : ''
    apiGet<CalendarEvent[]>(
      `/api/calendars/${calendarId}/events?from=${fetchInfo.startStr.slice(0, 10)}&to=${fetchInfo.endStr.slice(0, 10)}${tgParam}`
    ).then(events => {
      const q = searchQueryRef.current.trim().toLowerCase()
      const filtered = q ? events.filter(ev => ev.name.toLowerCase().includes(q)) : events
      successCallback(filtered.map(ev => {
        const startDateStr = ev.date.slice(0, 10)
        const endDateStr = ev.dateEnd?.slice(0, 10) ?? startDateStr
        const iconPrefix = ev.properties.map(p => p.property.icon).filter(Boolean).join('')
        const title = [iconPrefix, ev.name].filter(Boolean).join(' ')

        if (ev.isAllDay) {
          // FullCalendar all-day end is exclusive — add 1 day
          const endExclusive = new Date(endDateStr)
          endExclusive.setDate(endExclusive.getDate() + 1)
          return {
            id: String(ev.id),
            title,
            start: startDateStr,
            end: endExclusive.toISOString().slice(0, 10),
            allDay: true,
            backgroundColor: ev.isDraft ? '#94a3b8' : '#2563eb',
            borderColor: ev.isDraft ? '#94a3b8' : '#1d4ed8',
            textColor: '#fff',
            extendedProps: { event: ev },
          }
        }

        return {
          id: String(ev.id),
          title,
          start: `${startDateStr}T${ev.timeBegin}`,
          end: `${endDateStr}T${ev.timeEnd}`,
          backgroundColor: ev.isDraft ? '#94a3b8' : '#2563eb',
          borderColor: ev.isDraft ? '#94a3b8' : '#1d4ed8',
          textColor: '#fff',
          extendedProps: { event: ev },
        }
      }))
    }).catch(failureCallback)
  }

  function handleDateClick(info: DateClickArg) {
    openCreate(info.dateStr)
  }

  function handleEventClick(info: EventClickArg) {
    const ev = info.event.extendedProps.event as CalendarEvent
    openEdit(ev)
  }

  async function handleEventDrop(info: EventDropArg) {
    const ev = info.event.extendedProps.event as CalendarEvent
    const newStartStr = info.event.startStr.slice(0, 10)

    // If the event had a dateEnd, offset it by the same number of days
    let newDateEnd: string | null = null
    if (ev.dateEnd) {
      const oldStart = new Date(ev.date.slice(0, 10))
      const oldEnd = new Date(ev.dateEnd.slice(0, 10))
      const diffDays = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000)
      const newEnd = new Date(newStartStr)
      newEnd.setDate(newEnd.getDate() + diffDays)
      newDateEnd = newEnd.toISOString().slice(0, 10)
    }

    try {
      await apiPatch(`/api/calendars/${calendarId}/events/${ev.id}`, {
        date: newStartStr,
        ...(newDateEnd !== null ? { dateEnd: newDateEnd } : {}),
      })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
    } catch {
      info.revert()
    }
  }

  return (
    <div className="p-6">
      {isArchived && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800 font-medium">
            This calendar is archived — it is read-only.
          </p>
          <button
            onClick={handleUnarchive}
            className="flex items-center gap-1.5 text-xs text-amber-700 font-medium hover:text-amber-900 whitespace-nowrap"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
            Unarchive
          </button>
        </div>
      )}
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900">Calendar</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search events…"
              className="pl-8 pr-8 h-8 w-48 text-sm"
            />
            {searchQuery && (
              <button onClick={clearSearch} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Link href={`/clubs/${clubId}/calendars/${calendarId}/import`}>
            <Button size="sm" variant="outline">
              <Upload className="w-3.5 h-3.5 mr-1" />Import ICS
            </Button>
          </Link>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="w-3.5 h-3.5 mr-1" />New Event
          </Button>
        </div>
      </div>

      {/* Target group filter chips */}
      {targetGroups.length > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-slate-500">Filter:</span>
          <button
            onClick={clearFilter}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedGroups.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}
          >
            All
          </button>
          {targetGroups.map(tg => (
            <button
              key={tg.id}
              onClick={() => toggleGroup(tg.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selectedGroups.includes(tg.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}
            >
              {tg.name}
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          events={fetchEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          editable={true}
          eventDrop={handleEventDrop}
          selectable={false}
          firstDay={user?.firstDayOfWeek ?? 1}
          displayEventTime={true}
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth' }}
          height="auto"
          eventContent={renderEvent}
          locale="de"
        />
      </div>

      <p className="text-xs text-slate-400 mt-2">Click on an event to edit · Click a date to create</p>

      <EventModal
        calendarId={calendarId}
        open={modalOpen}
        onClose={closeModal}
        defaultDate={selectedDate}
        event={editingEvent}
      />
    </div>
  )
}

function renderEvent(info: { event: { title: string; start: Date | null; extendedProps: { event: CalendarEvent } }; timeText: string }) {
  const { timeText, event } = info
  const ev = event.extendedProps.event
  return (
    <div className="text-xs px-1 truncate">
      <span className="opacity-80">{timeText} </span>
      <span className="font-medium">{event.title}</span>
      {ev.isDraft && <span className="ml-1 opacity-60">(draft)</span>}
    </div>
  )
}
