'use client'
import { use, useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventClickArg, EventDropArg } from '@fullcalendar/core'
import type { DateClickArg } from '@fullcalendar/interaction'
import { apiGet, apiPatch } from '@/lib/api'
import type { CalendarEvent, TargetGroup } from '@/lib/types'
import { Button } from '@/components/ui/button'
import EventModal from '@/components/calendar/EventModal'
import { Plus } from 'lucide-react'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function CalendarPage({ params }: Props) {
  const { calendarId } = use(params)
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string | undefined>()
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [selectedGroups, setSelectedGroups] = useState<number[]>([])
  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null)

  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ['targetGroups', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  })

  function toggleGroup(id: number) {
    setSelectedGroups(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      // Force FullCalendar to refetch events with new filter
      setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0)
      return next
    })
  }

  function clearFilter() {
    setSelectedGroups([])
    setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0)
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
    const tgParam = selectedGroups.length > 0 ? `&targetGroupIds=${selectedGroups.join(',')}` : ''
    apiGet<CalendarEvent[]>(
      `/api/calendars/${calendarId}/events?from=${fetchInfo.startStr.slice(0, 10)}&to=${fetchInfo.endStr.slice(0, 10)}${tgParam}`
    ).then(events => {
      successCallback(events.map(ev => {
        const dateStr = ev.date.slice(0, 10)
        const iconPrefix = ev.properties.map(p => p.property.icon).filter(Boolean).join('')
        const title = [iconPrefix, ev.name].filter(Boolean).join(' ')
        return {
          id: String(ev.id),
          title,
          start: `${dateStr}T${ev.timeBegin}`,
          end: `${dateStr}T${ev.timeEnd}`,
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
    const newDate = info.event.startStr.slice(0, 10)
    try {
      await apiPatch(`/api/calendars/${calendarId}/events/${ev.id}`, { date: newDate })
      qc.invalidateQueries({ queryKey: ['events', calendarId] })
    } catch {
      info.revert()
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-slate-900">Calendar</h1>
        <Button size="sm" onClick={() => openCreate()}>
          <Plus className="w-3.5 h-3.5 mr-1" />New Event
        </Button>
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
