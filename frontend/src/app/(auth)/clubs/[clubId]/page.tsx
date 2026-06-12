'use client'
import { use, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api'
import type { Calendar, Club, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CalendarDays, Check, Plus } from 'lucide-react'

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
  const [clubName, setClubName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [confirmDeleteCalId, setConfirmDeleteCalId] = useState<number | null>(null)
  const [confirmDeleteClub, setConfirmDeleteClub] = useState(false)
  const [deletingClub, setDeletingClub] = useState(false)

  const { data: club } = useQuery<Club>({
    queryKey: ['club', clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  })
  useEffect(() => { if (club) setClubName(club.name) }, [club])

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ['members', clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  })

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ['calendars', clubId],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars`),
  })

  async function handleSaveClubName() {
    if (!clubName.trim() || clubName === club?.name) return
    setNameSaving(true)
    try {
      await apiPatch(`/api/clubs/${clubId}`, { name: clubName.trim() })
      qc.invalidateQueries({ queryKey: ['club', clubId] })
      qc.invalidateQueries({ queryKey: ['clubs'] })
      setNameSaved(true); setTimeout(() => setNameSaved(false), 2000)
    } finally { setNameSaving(false) }
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

  async function handleDeleteCalendar(calendarId: number) {
    await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`)
    setConfirmDeleteCalId(null)
    qc.invalidateQueries({ queryKey: ['calendars', clubId] })
  }

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return
    const cal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars`, { name: newCalName.trim() })
    setNewCalName('')
    setCalDialogOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId] })
    router.push(`/clubs/${clubId}/calendars/${cal.id}`)
  }

  async function handleDeleteClub() {
    setDeletingClub(true)
    try {
      await apiDelete(`/api/clubs/${clubId}`)
      qc.invalidateQueries({ queryKey: ['clubs'] })
      router.replace('/clubs')
    } finally { setDeletingClub(false) }
  }

  return (
    <div className="p-6 max-w-lg">
      {/* Club name */}
      <h2 className="text-base font-semibold text-slate-900 mb-4">Club</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="space-y-1.5">
          <Label>Name</Label>
          <div className="flex gap-2">
            <Input
              value={clubName}
              onChange={e => setClubName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveClubName()}
            />
            <Button size="sm" disabled={nameSaving || !clubName.trim() || clubName === club?.name} onClick={handleSaveClubName} className="gap-1.5">
              {nameSaved ? <><Check className="w-3.5 h-3.5" />Saved</> : nameSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      {/* Delete club */}
      <div className="mb-10">
        {!confirmDeleteClub ? (
          <button onClick={() => setConfirmDeleteClub(true)} className="text-xs text-red-400 hover:text-red-600 underline">
            Delete this club
          </button>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
            <p className="text-sm text-red-700 font-medium">
              This permanently deletes <strong>{club?.name}</strong> including all calendars and events. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" disabled={deletingClub} onClick={handleDeleteClub}>
                {deletingClub ? 'Deleting…' : 'Delete club'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteClub(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

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
            <div key={cal.id} className="rounded-xl border bg-white border-slate-200 overflow-hidden">
              {confirmDeleteCalId === cal.id ? (
                <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-red-200">
                  <span className="text-sm text-red-700">Delete <strong>{cal.name}</strong>?</span>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => handleDeleteCalendar(cal.id)}
                      className="text-xs text-red-600 font-medium px-2 py-1 rounded hover:bg-red-100 transition-colors"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteCalId(null)}
                      className="text-xs text-slate-500 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <button
                    onClick={() => router.push(`/clubs/${clubId}/calendars/${cal.id}`)}
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                  >
                    <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" />
                    <span className="text-sm font-medium text-slate-900 truncate">{cal.name}</span>
                  </button>
                  <button
                    onClick={() => setConfirmDeleteCalId(cal.id)}
                    className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))
        }
      </div>
    </div>
  )
}
