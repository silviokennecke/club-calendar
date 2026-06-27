import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventClickArg } from '@fullcalendar/core'
import { Button } from '@/components/ui/button'
import { TagBadge, FilterPillGroup } from '@/components/ui/shared'
import { Calendar, Download, X, MapPin, Clock, Tag, Users, Sparkles } from 'lucide-react'
import { formatAddress } from '@/lib/types'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

interface FeedEvent {
  id: number
  name: string
  date: string
  dateEnd?: string | null
  timeBegin: string
  timeEnd: string
  isAllDay?: boolean
  location?: { name?: string | null; street?: string | null; zip?: string | null; city?: string | null; country?: string | null; latitude?: number | null; longitude?: number | null } | null
  properties: { property: { id: number; name: string; icon: string | null } }[]
  features: { feature: { id: number; name: string } }[]
  targetGroups: { targetGroup: { id: number; name: string } }[]
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

function EventDetail({ ev, onClose }: { ev: FeedEvent; onClose: () => void }) {
  const startDate = formatDate(ev.date)
  const endDate = ev.dateEnd && ev.dateEnd.slice(0, 10) !== ev.date.slice(0, 10)
    ? formatDate(ev.dateEnd)
    : null

  const iconPrefix = ev.properties.map(p => p.property.icon).filter(Boolean).join('')
  const hasMap = ev.location?.latitude != null && ev.location?.longitude != null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors text-slate-500"
        >
          <X className="w-4 h-4" />
        </button>

        {hasMap && (
          <div className="w-full h-36 bg-slate-100 overflow-hidden">
            <img
              src={`${BASE}/api/mapbox/api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+2563eb(${ev.location!.longitude},${ev.location!.latitude})/${ev.location!.longitude},${ev.location!.latitude},14,0/800x288`}
              alt="Location map"
              className="w-full h-full object-cover"
            />
          </div>
        )}

        <div className="p-5 space-y-4">
          <div>
            {iconPrefix && <span className="text-2xl mr-2">{iconPrefix}</span>}
            <h2 className="text-lg font-bold text-slate-900 inline">{ev.name}</h2>
          </div>

          <div className="flex items-start gap-2.5 text-sm text-slate-700">
            <Clock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
            <div>
              {ev.isAllDay ? (
                <span>
                  {endDate ? `${startDate} – ${endDate}` : startDate}
                  <span className="ml-1.5 text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">All day</span>
                </span>
              ) : (
                <span>
                  {endDate
                    ? `${startDate} ${ev.timeBegin} – ${endDate} ${ev.timeEnd}`
                    : `${startDate}, ${ev.timeBegin} – ${ev.timeEnd}`}
                </span>
              )}
            </div>
          </div>

          {ev.location && (
            <div className="flex items-start gap-2.5 text-sm text-slate-700">
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                {ev.location.name && <p className="font-medium">{ev.location.name}</p>}
                {formatAddress(ev.location) && <p className={ev.location.name ? 'text-slate-500 text-xs' : ''}>{formatAddress(ev.location)}</p>}
                {ev.location.latitude != null && (
                  <a
                    href={`https://maps.google.com/?q=${ev.location.latitude},${ev.location.longitude}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-0.5 inline-block"
                  >
                    Open in Maps ↗
                  </a>
                )}
              </div>
            </div>
          )}

          {ev.targetGroups.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Users className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {ev.targetGroups.map(t => <TagBadge key={t.targetGroup.id} label={t.targetGroup.name} variant="purple" />)}
              </div>
            </div>
          )}

          {ev.properties.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Tag className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {ev.properties.map(p => <TagBadge key={p.property.id} label={p.property.name} icon={p.property.icon} variant="blue" />)}
              </div>
            </div>
          )}

          {ev.features.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {ev.features.map(f => <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function FeedPage() {
  const { feedId } = useParams<{ feedId: string }>()
  const [searchParams] = useSearchParams()
  const secret = searchParams.get('secret') ?? undefined
  const [feedName, setFeedName] = useState('')
  const [allEvents, setAllEvents] = useState<FeedEvent[]>([])
  const [allGroups, setAllGroups] = useState<{ id: number; name: string }[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [selectedEvent, setSelectedEvent] = useState<FeedEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = new URL(`${BASE}/api/feed/${feedId}/events`)
    if (secret) url.searchParams.set('secret', secret)
    fetch(url.toString())
      .then(async res => {
        if (!res.ok) {
          if (res.status === 403) setError('This feed is private. A valid key is required.')
          else if (res.status === 404) setError('Feed not found or not published.')
          else setError('Failed to load calendar.')
          return
        }
        const data = await res.json() as { feed: { name: string }; events: FeedEvent[] }
        setFeedName(data.feed.name)
        setAllEvents(data.events)
        const tgMap = new Map<number, string>()
        data.events.forEach(ev => ev.targetGroups.forEach(t => tgMap.set(t.targetGroup.id, t.targetGroup.name)))
        setAllGroups(Array.from(tgMap.entries()).map(([id, name]) => ({ id, name })))
      })
      .catch(() => setError('Failed to load calendar.'))
      .finally(() => setLoading(false))
  }, [feedId, secret])

  function toggleGroup(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const filtered = selected.length === 0 ? allEvents
    : allEvents.filter(ev => ev.targetGroups.some(t => selected.includes(t.targetGroup.id)))

  function buildUrl(proto: string) {
    const url = new URL(`${BASE.replace(/^https?:/, proto + ':')}/api/feed/${feedId}/ics`)
    if (secret) url.searchParams.set('secret', secret)
    if (selected.length > 0) url.searchParams.set('targetGroupIds', selected.join(','))
    return url.toString()
  }

  const fcEvents: EventInput[] = filtered.map(ev => {
    const startDateStr = ev.date.slice(0, 10)
    const endDateStr = ev.dateEnd?.slice(0, 10) ?? startDateStr
    const icons = ev.properties.map(p => p.property.icon).filter(Boolean).join('')

    if (ev.isAllDay) {
      const endExclusive = new Date(endDateStr)
      endExclusive.setDate(endExclusive.getDate() + 1)
      return {
        id: String(ev.id),
        title: [icons, ev.name].filter(Boolean).join(' '),
        start: startDateStr,
        end: endExclusive.toISOString().slice(0, 10),
        allDay: true,
        backgroundColor: '#2563eb', borderColor: '#1d4ed8',
        extendedProps: { event: ev },
      }
    }

    return {
      id: String(ev.id),
      title: [icons, ev.name].filter(Boolean).join(' '),
      start: `${startDateStr}T${ev.timeBegin}`,
      end: `${endDateStr}T${ev.timeEnd}`,
      backgroundColor: '#2563eb', borderColor: '#1d4ed8',
      extendedProps: { event: ev },
    }
  })

  function handleEventClick(info: EventClickArg) {
    const ev = info.event.extendedProps.event as FeedEvent
    setSelectedEvent(ev)
  }

  if (loading) return <div className="flex items-center justify-center min-h-screen bg-slate-50"><p className="text-slate-400">Loading...</p></div>
  if (error) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <div className="text-center"><Calendar className="w-10 h-10 text-slate-300 mx-auto mb-3" /><p className="text-slate-600 font-medium">{error}</p></div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Public Calendar</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">{feedName}</h1>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <a href={buildUrl('webcal')}>
                <Button size="sm" className="gap-1.5"><Calendar className="w-3.5 h-3.5" />Subscribe</Button>
              </a>
              <a href={buildUrl('http')} download>
                <Button size="sm" variant="outline" className="gap-1.5"><Download className="w-3.5 h-3.5" />ICS</Button>
              </a>
            </div>
          </div>

          {allGroups.length > 1 && (
            <FilterPillGroup
              label="Filter:"
              items={allGroups.map(tg => ({ id: String(tg.id), label: tg.name }))}
              selected={selected.map(String)}
              onChange={id => toggleGroup(Number(id))}
              onClearAll={() => setSelected([])}
              className="mt-4"
            />
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            events={fcEvents}
            eventClick={handleEventClick}
            displayEventTime
            eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
            height="auto"
            locale="de"
          />
        </div>
        {selected.length > 0 && (
          <p className="text-xs text-slate-400 mt-3 text-center">
            Showing {filtered.length} of {allEvents.length} events · Subscription reflects this filter
          </p>
        )}
        <p className="text-xs text-slate-400 mt-2 text-center">Click an event for details</p>
      </div>

      {selectedEvent && (
        <EventDetail ev={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  )
}
