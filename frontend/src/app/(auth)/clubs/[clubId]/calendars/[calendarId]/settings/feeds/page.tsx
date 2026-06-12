'use client'
import { use, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api'
import type { CalendarFeed, TargetGroup } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Plus, Copy, Eye, EyeOff, RefreshCw, Pencil, Trash2, Check } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

function icsUrl(feedId: number, secret?: string) {
  const base = `${API_URL}/api/feed/${feedId}/ics`
  return secret ? `${base}?secret=${secret}` : base
}
function webcalUrl(feedId: number, secret?: string) {
  return icsUrl(feedId, secret).replace(/^https?:/, 'webcal:')
}
function feedWebUrl(feedId: number, secret?: string) {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return secret ? `${base}/feed/${feedId}?secret=${secret}` : `${base}/feed/${feedId}`
}

interface FeedFormData {
  name: string
  visibility: 'PUBLIC' | 'PRIVATE'
  isDraft: boolean
  targetGroupIds: number[]
}

export default function FeedsPage({ params }: Props) {
  const { calendarId } = use(params)
  const qc = useQueryClient()

  const { data: feeds = [] } = useQuery<CalendarFeed[]>({
    queryKey: ['feeds', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/feeds`),
  })
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ['targetGroups', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingFeed, setEditingFeed] = useState<CalendarFeed | null>(null)
  const [form, setForm] = useState<FeedFormData>({ name: '', visibility: 'PRIVATE', isDraft: false, targetGroupIds: [] })
  const [saving, setSaving] = useState(false)
  const [secretVisible, setSecretVisible] = useState<Record<number, boolean>>({})
  const [copied, setCopied] = useState<number | null>(null)

  function openCreate() {
    setEditingFeed(null)
    setForm({ name: '', visibility: 'PRIVATE', isDraft: false, targetGroupIds: [] })
    setDialogOpen(true)
  }

  function openEdit(feed: CalendarFeed) {
    setEditingFeed(feed)
    setForm({
      name: feed.name,
      visibility: feed.visibility,
      isDraft: feed.isDraft,
      targetGroupIds: feed.targetGroups.map(t => t.targetGroupId),
    })
    setDialogOpen(true)
  }

  function toggleTargetGroup(id: number) {
    setForm(f => ({
      ...f,
      targetGroupIds: f.targetGroupIds.includes(id)
        ? f.targetGroupIds.filter(x => x !== id)
        : [...f.targetGroupIds, id],
    }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (editingFeed) {
        await apiPatch(`/api/calendars/${calendarId}/feeds/${editingFeed.id}`, form)
      } else {
        await apiPost(`/api/calendars/${calendarId}/feeds`, form)
      }
      qc.invalidateQueries({ queryKey: ['feeds', calendarId] })
      setDialogOpen(false)
    } finally { setSaving(false) }
  }

  async function handleDelete(id: number) {
    await apiDelete(`/api/calendars/${calendarId}/feeds/${id}`)
    qc.invalidateQueries({ queryKey: ['feeds', calendarId] })
  }

  async function handleRegenerate(id: number) {
    await apiPost(`/api/calendars/${calendarId}/feeds/${id}/regenerate-secret`, {})
    qc.invalidateQueries({ queryKey: ['feeds', calendarId] })
  }

  function copyToClipboard(text: string, feedId: number) {
    navigator.clipboard.writeText(text)
    setCopied(feedId)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Calendar Feeds</h2>
          <p className="text-sm text-slate-500 mt-0.5">Publish your calendar as an ICS feed for Apple Calendar, Google Calendar, etc.</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Feed</Button>
      </div>

      {feeds.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          No feeds yet. Create one to publish your calendar.
        </div>
      ) : (
        <div className="space-y-4">
          {feeds.map(feed => {
            const url = icsUrl(feed.id, feed.visibility === 'PRIVATE' ? feed.sharedSecret : undefined)
            const wurl = webcalUrl(feed.id, feed.visibility === 'PRIVATE' ? feed.sharedSecret : undefined)
            const tgNames = feed.targetGroups
              .map(ft => targetGroups.find(t => t.id === ft.targetGroupId)?.name)
              .filter(Boolean)

            return (
              <div key={feed.id} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-slate-900">{feed.name}</span>
                      <Badge variant={feed.visibility === 'PUBLIC' ? 'default' : 'secondary'} className="text-xs">
                        {feed.visibility}
                      </Badge>
                      {feed.isDraft && <Badge variant="outline" className="text-xs text-slate-500">Draft</Badge>}
                    </div>
                    {tgNames.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {tgNames.map(name => (
                          <span key={name} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">{name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(feed)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                    <AlertDialog>
                      <AlertDialogTrigger render={<button className="text-slate-400 hover:text-red-500 p-1.5 rounded" />}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete feed?</AlertDialogTitle>
                          <AlertDialogDescription>Subscribers using this URL will lose access.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(feed.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {/* ICS URL */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">ICS Subscription URL</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 truncate text-slate-700 font-mono">
                      {url}
                    </code>
                    <button onClick={() => copyToClipboard(url, feed.id)} title="Copy URL" className="text-slate-400 hover:text-slate-700 p-1.5 rounded border border-slate-200 hover:bg-slate-50">
                      {copied === feed.id ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <a href={wurl} className="text-xs text-blue-600 hover:underline whitespace-nowrap">Open in App</a>
                  </div>
                </div>

                {/* Web view URL */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">Web View</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 truncate text-slate-700 font-mono">
                      {feedWebUrl(feed.id, feed.visibility === 'PRIVATE' ? feed.sharedSecret : undefined)}
                    </code>
                    <a
                      href={feedWebUrl(feed.id, feed.visibility === 'PRIVATE' ? feed.sharedSecret : undefined)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-blue-600 hover:underline text-xs px-2.5 py-1.5 border border-slate-200 rounded hover:bg-slate-50 transition-colors"
                    >
                      Open ↗
                    </a>
                  </div>
                </div>

                {/* Shared secret */}
                {feed.visibility === 'PRIVATE' && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">Shared Secret</Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-md px-3 py-2 font-mono text-slate-700 truncate">
                        {secretVisible[feed.id] ? feed.sharedSecret : '••••••••••••••••••••••••••••••••••••'}
                      </code>
                      <button onClick={() => setSecretVisible(s => ({ ...s, [feed.id]: !s[feed.id] }))} title="Toggle visibility" className="text-slate-400 hover:text-slate-700 p-1.5 rounded border border-slate-200 hover:bg-slate-50">
                        {secretVisible[feed.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => handleRegenerate(feed.id)} title="Regenerate secret" className="text-slate-400 hover:text-orange-500 p-1.5 rounded border border-slate-200 hover:bg-slate-50">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">Regenerating will break existing subscriptions.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={v => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFeed ? 'Edit Feed' : 'New Feed'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input placeholder="e.g. Public Calendar" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            <div className="space-y-1">
              <Label>Visibility</Label>
              <div className="flex gap-2">
                {(['PUBLIC', 'PRIVATE'] as const).map(v => (
                  <button key={v} onClick={() => setForm(f => ({ ...f, visibility: v }))}
                    className={`flex-1 py-2 text-sm rounded-md border transition-colors ${form.visibility === v ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {v === 'PUBLIC' ? '🌐 Public' : '🔒 Private'}
                  </button>
                ))}
              </div>
              {form.visibility === 'PRIVATE' && <p className="text-xs text-slate-400">A shared secret will be generated automatically.</p>}
            </div>

            <div className="flex items-center gap-2">
              <Switch id="feed-draft" checked={!form.isDraft} onCheckedChange={v => setForm(f => ({ ...f, isDraft: !v }))} />
              <Label htmlFor="feed-draft">Published {form.isDraft && <span className="text-xs text-slate-400">(draft — not accessible)</span>}</Label>
            </div>

            {targetGroups.length > 0 && (
              <div className="space-y-1.5">
                <Label>Filter by Target Group <span className="text-slate-400 font-normal">(optional — empty = all events)</span></Label>
                <div className="flex flex-wrap gap-1.5">
                  {targetGroups.map(tg => (
                    <button key={tg.id} type="button" onClick={() => toggleTargetGroup(tg.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${form.targetGroupIds.includes(tg.id) ? 'bg-purple-100 border-purple-300 text-purple-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                      {tg.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={saving || !form.name.trim()} onClick={handleSave}>
              {saving ? 'Saving...' : editingFeed ? 'Save Changes' : 'Create Feed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
