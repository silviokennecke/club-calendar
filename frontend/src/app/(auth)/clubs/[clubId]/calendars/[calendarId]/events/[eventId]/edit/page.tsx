'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPatch, apiDelete } from '@/lib/api'
import type { CalendarEvent } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { use } from 'react'

interface Props {
  params: Promise<{ clubId: string; calendarId: string; eventId: string }>
}

export default function EditEventPage({ params }: Props) {
  const { clubId, calendarId, eventId } = use(params)
  const router = useRouter()
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [timeBegin, setTimeBegin] = useState('09:00')
  const [timeEnd, setTimeEnd] = useState('10:00')
  const [isDraft, setIsDraft] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)

  useEffect(() => {
    apiGet<CalendarEvent>(`/api/calendars/${calendarId}/events/${eventId}`)
      .then((ev) => {
        setName(ev.name)
        setDate(ev.date.slice(0, 10))
        setTimeBegin(ev.timeBegin)
        setTimeEnd(ev.timeEnd)
        setIsDraft(ev.isDraft)
      })
      .catch(() => setError('Failed to load event'))
      .finally(() => setFetching(false))
  }, [calendarId, eventId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await apiPatch(`/api/calendars/${calendarId}/events/${eventId}`, {
        name,
        date,
        timeBegin,
        timeEnd,
        isDraft,
      })
      router.push(`/clubs/${clubId}/calendars/${calendarId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update event')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this event?')) return
    setLoading(true)
    try {
      await apiDelete(`/api/calendars/${calendarId}/events/${eventId}`)
      router.push(`/clubs/${clubId}/calendars/${calendarId}`)
    } catch {
      setError('Failed to delete event')
      setLoading(false)
    }
  }

  if (fetching) return <div className="flex items-center justify-center min-h-screen">Loading...</div>

  return (
    <div className="container mx-auto p-6 max-w-lg">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-sm text-muted-foreground hover:underline">← Calendar</Link>
        <h1 className="text-xl font-bold">Edit Event</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Edit Event</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="timeBegin">Start Time</Label>
                <Input id="timeBegin" type="time" value={timeBegin} onChange={(e) => setTimeBegin(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="timeEnd">End Time</Label>
                <Input id="timeEnd" type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} required />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="isDraft"
                type="checkbox"
                checked={isDraft}
                onChange={(e) => setIsDraft(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="isDraft">Draft</Label>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-between">
              <div className="flex gap-2">
                <Button type="submit" disabled={loading}>
                  {loading ? 'Saving...' : 'Save'}
                </Button>
                <Link href={`/clubs/${clubId}/calendars/${calendarId}`}>
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
              </div>
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={loading}>
                Delete
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
