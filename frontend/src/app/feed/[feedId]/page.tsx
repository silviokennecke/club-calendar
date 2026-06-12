'use client'

import { use, useEffect, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props {
  params: Promise<{ feedId: string }>
  searchParams: Promise<{ secret?: string }>
}

interface EventProperty {
  property: { icon: string | null }
}

interface FeedEvent {
  id: number
  name: string
  date: string
  timeBegin: string
  timeEnd: string
  isDraft: boolean
  properties: EventProperty[]
}

interface FeedResponse {
  feed: { id: number; name: string }
  events: FeedEvent[]
}

export default function PublicFeedPage({ params, searchParams }: Props) {
  const { feedId } = use(params)
  const { secret } = use(searchParams)
  const [feedName, setFeedName] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // ICS subscription URL for "Add to Calendar" button
  const icsUrl = `${BASE_URL}/api/feed/${feedId}/ics${secret ? `?secret=${secret}` : ''}`
  const webcalUrl = icsUrl.replace(/^https?:/, 'webcal:')

  // Validate feed is accessible before rendering calendar
  useEffect(() => {
    const url = `${BASE_URL}/api/feed/${feedId}/events${secret ? `?secret=${secret}` : ''}`
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 403) setError('This calendar is private. A valid secret is required.')
          else if (res.status === 404) setError('Calendar feed not found.')
          else setError('Failed to load calendar.')
        } else {
          return res.json().then((data: FeedResponse) => setFeedName(data.feed.name))
        }
      })
      .catch(() => setError('Failed to load calendar.'))
      .finally(() => setLoading(false))
  }, [feedId, secret])

  function fetchEvents(
    _fetchInfo: { startStr: string; endStr: string },
    successCallback: (events: object[]) => void,
    failureCallback: (err: Error) => void,
  ) {
    const url = `${BASE_URL}/api/feed/${feedId}/events${secret ? `?secret=${secret}` : ''}`
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then((data: FeedResponse) => {
        successCallback(
          data.events.map((ev) => {
            const icons = ev.properties
              .map((p) => p.property.icon)
              .filter(Boolean)
              .join(' ')
            return {
              id: String(ev.id),
              title: icons ? `${icons} ${ev.name}` : ev.name,
              start: `${ev.date.slice(0, 10)}T${ev.timeBegin}`,
              end: `${ev.date.slice(0, 10)}T${ev.timeEnd}`,
              backgroundColor: '#3b82f6',
            }
          }),
        )
      })
      .catch(failureCallback)
  }

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen">Loading...</div>
    )

  if (error)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-lg text-muted-foreground">{error}</p>
        </div>
      </div>
    )

  return (
    <div className="container mx-auto p-4 max-w-4xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">{feedName}</h1>
          <Badge variant="outline" className="mt-1">
            Public Calendar
          </Badge>
        </div>
        <a href={webcalUrl}>
          <Button variant="outline" size="sm">
            Subscribe in Calendar App
          </Button>
        </a>
      </div>
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView="dayGridMonth"
        events={fetchEvents}
        headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
        height="auto"
        locale="de"
      />
      <div className="mt-4 text-sm text-muted-foreground">
        <p>
          ICS subscription URL:{' '}
          <code className="bg-gray-100 px-1 rounded">{icsUrl}</code>
        </p>
      </div>
    </div>
  )
}
