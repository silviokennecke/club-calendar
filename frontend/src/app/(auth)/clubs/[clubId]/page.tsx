'use client'
import { use, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiGet, apiPost, apiDelete } from '@/lib/api'
import type { Calendar, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CalendarDays, Plus } from 'lucide-react'

interface Props { params: Promise<{ clubId: string }> }

export default function ClubPage({ params }: Props) {
  const { clubId } = use(params)
  const qc = useQueryClient()
  const router = useRouter()
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [newCalName, setNewCalName] = useState('')
  const [calDialogOpen, setCalDialogOpen] = useState(false)

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ['members', clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  })

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ['calendars', clubId],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars`),
  })

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

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return
    const cal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars`, { name: newCalName.trim() })
    setNewCalName('')
    setCalDialogOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId] })
    router.push(`/clubs/${clubId}/calendars/${cal.id}`)
  }

  return (
    <div className="p-6 max-w-lg">
      {/* Members */}
      <h2 className="text-base font-semibold text-slate-900 mb-4">Members</h2>
      <div className="flex gap-2 mb-3">
        <Input
          placeholder="user@example.com"
          value={newMemberEmail}
          onChange={e => setNewMemberEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAddMember()}
        />
        <Button size="sm" disabled={addingMember} onClick={handleAddMember}>Add</Button>
      </div>
      {memberError && <p className="text-sm text-red-500 mb-3">{memberError}</p>}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-10">
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

      {/* Calendars */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900">Calendars</h2>
        <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
            <Plus className="w-3.5 h-3.5" />New
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Calendar</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <Input
                placeholder="Calendar name"
                value={newCalName}
                onChange={e => setNewCalName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateCalendar()}
                autoFocus
              />
              <Button className="w-full" onClick={handleCreateCalendar}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {calendars.length === 0
          ? <p className="text-sm text-slate-400 py-4">No calendars yet.</p>
          : calendars.map(cal => (
            <button
              key={cal.id}
              onClick={() => router.push(`/clubs/${clubId}/calendars/${cal.id}`)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left bg-white border-slate-200 text-slate-900 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="text-sm font-medium">{cal.name}</span>
            </button>
          ))
        }
      </div>
    </div>
  )
}
