'use client'
import { use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import type { Club, Calendar } from '@/lib/types'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'

interface Props { params: Promise<{ clubId: string }> }

export default function ClubPage({ params }: Props) {
  const { clubId } = use(params)
  const qc = useQueryClient()
  const [newCalName, setNewCalName] = useState('')
  const [open, setOpen] = useState(false)

  const { data: club } = useQuery({
    queryKey: ['club', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })
  const { data: calendars = [] } = useQuery({
    queryKey: ['calendars', clubId],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars`),
  })

  async function handleCreate() {
    if (!newCalName.trim()) return
    await apiPost(`/api/clubs/${clubId}/calendars`, { name: newCalName })
    setNewCalName('')
    setOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId] })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3">
        <Link href="/clubs" className="text-slate-400 hover:text-slate-600">
          <ChevronLeft className="w-4 h-4" />
        </Link>
        <span className="font-semibold text-slate-900">{club?.name ?? '...'}</span>
      </div>
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">Calendars</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              + New Calendar
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Calendar</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Calendar name"
                  value={newCalName}
                  onChange={e => setNewCalName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
                <Button className="w-full" onClick={handleCreate}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        {calendars.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No calendars yet. Create your first one.</div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {calendars.map(cal => (
              <Link key={cal.id} href={`/clubs/${clubId}/calendars/${cal.id}`}>
                <Card className="hover:shadow-md transition-all cursor-pointer border-slate-200 hover:border-blue-200">
                  <CardHeader><CardTitle className="text-base">{cal.name}</CardTitle></CardHeader>
                  <CardContent><p className="text-xs text-slate-500">Click to open</p></CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}