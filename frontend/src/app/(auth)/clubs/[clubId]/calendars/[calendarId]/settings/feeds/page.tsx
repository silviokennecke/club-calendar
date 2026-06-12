'use client'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
import type { CalendarFeed } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { use } from 'react'

interface Props {
  params: Promise<{ clubId: string; calendarId: string }>
}

export default function FeedsPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const queryClient = useQueryClient()
  const [newFeedName, setNewFeedName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const { data: feeds = [] } = useQuery({
    queryKey: ['calendars', calendarId, 'feeds'],
    queryFn: () => apiGet<CalendarFeed[]>(`/api/calendars/${calendarId}/feeds`),
  })

  const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

  function icsUrl(feed: CalendarFeed) {
    return `${BASE_URL}/api/feeds/${feed.sharedSecret}/calendar.ics`
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setCreating(true)
    try {
      await apiPost(`/api/calendars/${calendarId}/feeds`, {
        name: newFeedName,
        visibility: 'PUBLIC',
        isDraft: false,
      })
      setNewFeedName('')
      queryClient.invalidateQueries({ queryKey: ['calendars', calendarId, 'feeds'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create feed')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(feedId: number) {
    if (!confirm('Delete this feed?')) return
    try {
      await apiDelete(`/api/calendars/${calendarId}/feeds/${feedId}`)
      queryClient.invalidateQueries({ queryKey: ['calendars', calendarId, 'feeds'] })
    } catch {
      setError('Failed to delete feed')
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/clubs/${clubId}/calendars/${calendarId}`} className="text-sm text-muted-foreground hover:underline">← Calendar</Link>
        <h1 className="text-xl font-bold">Calendar Feeds</h1>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Create New Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="flex gap-2">
            <div className="flex-1 space-y-1">
              <Label htmlFor="feedName">Feed Name</Label>
              <Input
                id="feedName"
                value={newFeedName}
                onChange={(e) => setNewFeedName(e.target.value)}
                placeholder="e.g. Public Events"
                required
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
          {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {feeds.map((feed) => (
          <Card key={feed.id}>
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-base">{feed.name}</CardTitle>
                  <div className="flex gap-2 mt-1">
                    <Badge variant={feed.visibility === 'PUBLIC' ? 'default' : 'secondary'}>
                      {feed.visibility}
                    </Badge>
                    {feed.isDraft && <Badge variant="outline">Draft</Badge>}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(feed.id)}
                >
                  Delete
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Label className="text-xs text-muted-foreground">ICS URL</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  readOnly
                  value={icsUrl(feed)}
                  className="text-xs font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigator.clipboard.writeText(icsUrl(feed))}
                >
                  Copy
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {feeds.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No feeds yet. Create one above.</p>
        )}
      </div>
    </div>
  )
}
