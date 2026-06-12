'use client'
import { use } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
import type { Club, Calendar, User } from '@/lib/types'
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
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')

  const { data: club } = useQuery({
    queryKey: ['club', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })
  const { data: calendars = [] } = useQuery({
    queryKey: ['calendars', clubId],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars`),
  })

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ['members', clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  })

  async function handleCreate() {
    if (!newCalName.trim()) return
    await apiPost(`/api/clubs/${clubId}/calendars`, { name: newCalName })
    setNewCalName('')
    setOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId] })
  }

  async function handleAddMember() {
    if (!newMemberEmail.trim()) return
    setAddingMember(true); setMemberError('')
    try {
      await apiPost(`/api/clubs/${clubId}/members`, { email: newMemberEmail.trim() })
      setNewMemberEmail('')
      qc.invalidateQueries({ queryKey: ['members', clubId] })
    } catch (e: unknown) {
      setMemberError((e as Error).message ?? 'User not found')
    } finally { setAddingMember(false) }
  }

  async function handleRemoveMember(userId: number) {
    await apiDelete(`/api/clubs/${clubId}/members/${userId}`)
    qc.invalidateQueries({ queryKey: ['members', clubId] })
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

        <div className="mt-10">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Members</h2>
          <div className="flex gap-2 mb-4">
            <Input placeholder="user@example.com" value={newMemberEmail}
              onChange={e => setNewMemberEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddMember()}
              className="max-w-sm" />
            <Button size="sm" disabled={addingMember} onClick={handleAddMember}>Add Member</Button>
          </div>
          {memberError && <p className="text-sm text-red-500 mb-3">{memberError}</p>}
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 max-w-lg">
            {members.length === 0
              ? <p className="text-sm text-slate-400 p-4">No members yet.</p>
              : members.map((m: User) => (
                <div key={m.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{m.name}</p>
                    <p className="text-xs text-slate-500">{m.email}</p>
                  </div>
                  <button onClick={() => handleRemoveMember(m.id)}
                    className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">
                    Remove
                  </button>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}
