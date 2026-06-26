import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  getHolidayCalendars,
  createHolidayCalendar,
  deleteHolidayCalendar,
  refreshHolidayCalendar,
} from '@/lib/api'
import type { HolidayCalendar } from '@/lib/types'

export default function HolidayCalendarsPage() {
  const { calendarId } = useParams<{ calendarId: string }>()

  const [items, setItems] = useState<HolidayCalendar[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', url: '' })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setItems(await getHolidayCalendars(calendarId!))
    } finally {
      setLoading(false)
    }
  }, [calendarId])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    setSaving(true)
    setAddError(null)
    try {
      const created = await createHolidayCalendar(calendarId!, form)
      setItems(prev => [...prev, created])
      setShowAdd(false)
      setForm({ name: '', url: '' })
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to create')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(hcId: number) {
    if (!window.confirm('Delete this holiday calendar and all its events?')) return
    try {
      await deleteHolidayCalendar(calendarId!, hcId)
      setItems(prev => prev.filter(hc => hc.id !== hcId))
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handleRefresh(hcId: number) {
    setRefreshingId(hcId)
    try {
      const updated = await refreshHolidayCalendar(calendarId!, hcId)
      setItems(prev => prev.map(hc => (hc.id === hcId ? updated : hc)))
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshingId(null)
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900">Holiday Calendars</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => setShowAdd(true)}>Add ICS Feed</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          No holiday calendars yet. Add an ICS URL to import public holidays.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map(hc => (
            <li key={hc.id} className="flex items-start justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">{hc.name}</p>
                <p className="text-sm text-muted-foreground break-all">{hc.url}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hc.eventCount} events
                  {hc.lastFetchedAt &&
                    ` · Last fetched: ${new Date(hc.lastFetchedAt).toLocaleString()}`}
                </p>
              </div>
              <div className="ml-4 flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={refreshingId === hc.id}
                  onClick={() => handleRefresh(hc.id)}
                >
                  {refreshingId === hc.id ? 'Refreshing…' : 'Refresh'}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => handleDelete(hc.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={showAdd} onOpenChange={open => { setShowAdd(open); if (!open) setAddError(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Holiday Calendar</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="hc-name">Name</Label>
              <Input
                id="hc-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="German Public Holidays"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="hc-url">ICS URL</Label>
              <Input
                id="hc-url"
                type="url"
                value={form.url}
                onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                placeholder="https://calendar.google.com/calendar/ical/..."
              />
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={saving || !form.name || !form.url}>
              {saving ? 'Adding…' : 'Add & Fetch'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
