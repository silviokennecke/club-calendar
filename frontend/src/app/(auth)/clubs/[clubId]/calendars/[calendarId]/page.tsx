'use client'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import { apiGet } from '@/lib/api'
import type { CalendarEvent } from '@/lib/types'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { EventSourceFuncArg } from '@fullcalendar/core'
import { use } from 'react'

interface Props {
  params: Promise<{ clubId: string; calendarId: string }>
}

export default function CalendarPage({ params }: Props) {
  const { calendarId, clubId } = use(params)
  const router = useRouter()

  function fetchEvents(fetchInfo: EventSourceFuncArg, successCallback: (events: object[]) => void) {
    apiGet<CalendarEvent[]>(
      `/api/calendars/${calendarId}/events?from=${fetchInfo.startStr.slice(0, 10)}&to=${fetchInfo.endStr.slice(0, 10)}`
    ).then((events) => {
      successCallback(
        events.map((ev) => ({
          id: String(ev.id),
          title: `${ev.isDraft ? '[Draft] ' : ''}${ev.name}`,
          start: `${ev.date.slice(0, 10)}T${ev.timeBegin}`,
          end: `${ev.date.slice(0, 10)}T${ev.timeEnd}`,
          backgroundColor: ev.isDraft ? '#94a3b8' : '#3b82f6',
          extendedProps: ev,
        }))
      )
    })
  }

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <Link href={`/clubs/${clubId}`} className="text-sm text-muted-foreground hover:underline">← Club</Link>
          <h1 className="text-xl font-semibold">Calendar</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/clubs/${clubId}/calendars/${calendarId}/events/new`}>
            <Button size="sm">+ New Event</Button>
          </Link>
          <Link href={`/clubs/${clubId}/calendars/${calendarId}/templates`}>
            <Button size="sm" variant="outline">Templates</Button>
          </Link>
          <Link href={`/clubs/${clubId}/calendars/${calendarId}/settings/feeds`}>
            <Button size="sm" variant="outline">Feeds</Button>
          </Link>
        </div>
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        events={fetchEvents}
        eventClick={(info) => {
          router.push(`/clubs/${clubId}/calendars/${calendarId}/events/${info.event.id}/edit`)
        }}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: 'dayGridMonth' }}
        height="auto"
      />
    </div>
  )
}
