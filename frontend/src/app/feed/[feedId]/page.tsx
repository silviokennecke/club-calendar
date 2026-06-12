'use client'
import { use, useState, useEffect } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import type { EventInput } from '@fullcalendar/core'
import { Button } from '@/components/ui/button'
import { Calendar, Download } from 'lucide-react'

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface FeedEvent {
  id: number; name: string; date: string; timeBegin: string; timeEnd: string
  location?: { address: string } | null
  properties: { property: { icon: string | null } }[]
  targetGroups: { targetGroup: { id: number; name: string } }[]
}

interface Props {
  params: Promise<{ feedId: string }>
  searchParams: Promise<{ secret?: string }>
}

export default function PublicFeedPage({ params, searchParams }: Props) {
  const { feedId } = use(params)
  const { secret } = use(searchParams)
  const [feedName, setFeedName] = useState('')
  const [allEvents, setAllEvents] = useState<FeedEvent[]>([])
  const [allGroups, setAllGroups] = useState<{ id: number; name: string }[]>([])
  const [selected, setSelected] = useState<number[]>([])
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
    const dateStr = ev.date.slice(0, 10)
    const icons = ev.properties.map(p => p.property.icon).filter(Boolean).join('')
    return {
      id: String(ev.id),
      title: [icons, ev.name].filter(Boolean).join(' '),
      start: `${dateStr}T${ev.timeBegin}`,
      end: `${dateStr}T${ev.timeEnd}`,
      backgroundColor: '#2563eb', borderColor: '#1d4ed8',
    }
  })

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
            <div className="flex items-center gap-2 mt-4 flex-wrap">
              <span className="text-xs text-slate-500">Filter:</span>
              <button onClick={() => setSelected([])} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selected.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>All</button>
              {allGroups.map(tg => (
                <button key={tg.id} onClick={() => toggleGroup(tg.id)} className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${selected.includes(tg.id) ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>{tg.name}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <FullCalendar plugins={[dayGridPlugin]} initialView="dayGridMonth" events={fcEvents}
            displayEventTime eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
            headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }} height="auto" locale="de" />
        </div>
        {selected.length > 0 && (
          <p className="text-xs text-slate-400 mt-3 text-center">Showing {filtered.length} of {allEvents.length} events · Subscription reflects this filter</p>
        )}
      </div>
    </div>
  )
}
