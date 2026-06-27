import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api'
import type { Calendar, Club, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FormField, SectionHeader, ListCard, ListRow, DangerZoneConfirm } from '@/components/ui/shared'
import { CalendarDays, Check, Plus, Archive, ArchiveRestore, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'

function formatArchivedAt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export default function ClubPage() {
  const { t } = useTranslation()
  const { clubId } = useParams<{ clubId: string }>()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [newCalName, setNewCalName] = useState('')
  const [calDialogOpen, setCalDialogOpen] = useState(false)
  const [clubName, setClubName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [nameSaving, setNameSaving] = useState(false)
  const [confirmDeleteCalId, setConfirmDeleteCalId] = useState<string | null>(null)
  const [deletingClub, setDeletingClub] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

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
    queryKey: ['calendars', clubId, 'all'],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`),
  })

  const activeCalendars = calendars.filter(c => !c.archivedAt)
  const archivedCalendars = calendars.filter(c => !!c.archivedAt)

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

  async function handleRemoveMember(userId: string) {
    await apiDelete(`/api/clubs/${clubId}/members/${userId}`)
    qc.invalidateQueries({ queryKey: ['members', clubId] })
  }

  async function handleDeleteCalendar(calendarId: string) {
    await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`)
    setConfirmDeleteCalId(null)
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return
    const cal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars`, { name: newCalName.trim() })
    setNewCalName('')
    setCalDialogOpen(false)
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
    navigate(`/clubs/${clubId}/calendars/${cal.id}`)
  }

  async function handleArchive(calendarId: string) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/archive`, {})
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleUnarchive(calendarId: string) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {})
    qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
  }

  async function handleDuplicate(calendarId: string) {
    setDuplicatingId(calendarId)
    try {
      const newCal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}/duplicate`, {})
      qc.invalidateQueries({ queryKey: ['calendars', clubId, 'all'] })
      navigate(`/clubs/${clubId}/calendars/${newCal.id}`)
    } finally { setDuplicatingId(null) }
  }

  async function handleDeleteClub() {
    setDeletingClub(true)
    try {
      await apiDelete(`/api/clubs/${clubId}`)
      qc.invalidateQueries({ queryKey: ['clubs'] })
      navigate('/clubs', { replace: true })
    } finally { setDeletingClub(false) }
  }

  function CalendarCard({ cal, archived = false }: { cal: Calendar; archived?: boolean }) {
    if (confirmDeleteCalId === cal.id) {
      return (
        <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-red-200 rounded-xl border">
          <span className="text-sm text-red-700">{t('common.delete')} <strong>{cal.name}</strong>?</span>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => handleDeleteCalendar(cal.id)} className="text-xs text-red-600 font-medium px-2 py-1 rounded hover:bg-red-100 transition-colors">{t('common.delete')}</button>
            <button onClick={() => setConfirmDeleteCalId(null)} className="text-xs text-slate-500 px-2 py-1 rounded hover:bg-slate-100 transition-colors">{t('common.cancel')}</button>
          </div>
        </div>
      )
    }

    return (
      <div className={`rounded-xl border bg-white overflow-hidden ${archived ? 'border-slate-100 opacity-70' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2 px-4 py-3 hover:bg-slate-50 transition-colors">
          {archived ? (
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-500 truncate block">{cal.name}</span>
                <span className="text-xs text-slate-400">{t('club.archived')} · {formatArchivedAt(cal.archivedAt!)}</span>
              </div>
            </div>
          ) : (
            <button onClick={() => navigate(`/clubs/${clubId}/calendars/${cal.id}`)} className="flex items-center gap-3 flex-1 text-left min-w-0">
              <CalendarDays className="w-4 h-4 shrink-0 text-slate-400" />
              <span className="text-sm font-medium text-slate-900 truncate">{cal.name}</span>
            </button>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {archived ? (
              <button onClick={() => handleUnarchive(cal.id)} title="Unarchive" className="text-slate-400 hover:text-blue-500 p-1.5 rounded hover:bg-blue-50 transition-colors">
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                <button onClick={() => handleDuplicate(cal.id)} disabled={duplicatingId === cal.id} title="Duplicate" className="text-slate-400 hover:text-slate-600 p-1.5 rounded hover:bg-slate-100 transition-colors disabled:opacity-40">
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleArchive(cal.id)} title="Archive" className="text-slate-400 hover:text-amber-500 p-1.5 rounded hover:bg-amber-50 transition-colors">
                  <Archive className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button onClick={() => setConfirmDeleteCalId(cal.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">{t('common.delete')}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-4">{t('club.title')}</h2>
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <FormField label={t('club.clubName')}>
          <div className="flex gap-2">
            <Input value={clubName} onChange={e => setClubName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSaveClubName()} />
            <Button size="sm" disabled={nameSaving || !clubName.trim() || clubName === club?.name} onClick={handleSaveClubName} className="gap-1.5">
              {nameSaved ? <><Check className="w-3.5 h-3.5" />{t('club.saved')}</> : nameSaving ? t('club.saving') : t('club.save')}
            </Button>
          </div>
        </FormField>
      </div>

      <div className="mb-10">
        <DangerZoneConfirm
          triggerLabel={t('club.deleteThisClub')}
          description={t('club.deleteClubConfirm')}
          confirmLabel={t('club.deleteClub')}
          onConfirm={handleDeleteClub}
          isLoading={deletingClub}
        />
      </div>

      <h2 className="text-base font-semibold text-slate-900 mb-4">{t('club.members')}</h2>
      <div className="flex gap-2 mb-3">
        <Input placeholder="user@example.com" value={newMemberEmail} onChange={e => setNewMemberEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddMember()} />
        <Button size="sm" disabled={addingMember} onClick={handleAddMember}>{t('club.addMember')}</Button>
      </div>
      {memberError && <p className="text-sm text-red-500 mb-3">{memberError}</p>}
      <ListCard
        items={members}
        emptyMessage={t('club.noMembers')}
        className="mb-10"
        renderItem={(m: User) => (
          <ListRow
            title={m.name}
            subtitle={m.email}
            actions={
              <button onClick={() => handleRemoveMember(m.id)} className="text-slate-400 hover:text-red-500 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">{t('club.removeMember')}</button>
            }
          />
        )}
      />

      <SectionHeader
        title={t('club.calendars')}
        className="mb-4"
        action={
          <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
              <Plus className="w-3.5 h-3.5" />{t('club.newCalendarButton')}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{t('club.createCalendar')}</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input placeholder={t('club.calendarNamePlaceholder')} value={newCalName} onChange={e => setNewCalName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateCalendar()} autoFocus />
                <Button className="w-full" onClick={handleCreateCalendar}>{t('common.create')}</Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-2">
        {activeCalendars.length === 0 && archivedCalendars.length === 0 && (
          <p className="text-sm text-slate-400 py-4">{t('club.noCalendars')}</p>
        )}
        {activeCalendars.map(cal => <CalendarCard key={cal.id} cal={cal} />)}
      </div>

      {archivedCalendars.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{t('club.archived')}</p>
          {archivedCalendars.map(cal => <CalendarCard key={cal.id} cal={cal} archived />)}
        </div>
      )}
    </div>
  )
}
