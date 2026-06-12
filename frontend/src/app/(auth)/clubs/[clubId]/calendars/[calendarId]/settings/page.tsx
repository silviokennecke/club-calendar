'use client'
import { use, useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch, apiPost, apiDelete } from '@/lib/api'
import type { Calendar, User } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from 'lucide-react'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function CalendarSettingsPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [tzSearch, setTzSearch] = useState('')
  const [showTzDropdown, setShowTzDropdown] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')

  const { data: calendar } = useQuery({
    queryKey: ['calendar', calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  })
  useEffect(() => {
    if (calendar) {
      setName(calendar.name)
      setTimezone(calendar.timezone ?? '')
    }
  }, [calendar])

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ['members', clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  })

  async function handleSave() {
    setSaving(true)
    try {
      await apiPatch(`/api/clubs/${clubId}/calendars/${calendarId}`, { name, timezone: timezone || null })
      qc.invalidateQueries({ queryKey: ['calendar', calendarId] })
      qc.invalidateQueries({ queryKey: ['calendars', clubId] })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
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
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-6">General Settings</h2>
      <div className="space-y-4 bg-white rounded-xl border border-slate-200 p-5">
        <div className="space-y-1.5">
          <Label>Calendar Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <Label>Timezone <span className="text-slate-400 font-normal">(overrides club default)</span></Label>
          <div className="relative">
            <Input
              value={tzSearch || timezone}
              onChange={e => { setTzSearch(e.target.value); setShowTzDropdown(true) }}
              onFocus={() => { setTzSearch(''); setShowTzDropdown(true) }}
              onBlur={() => setTimeout(() => setShowTzDropdown(false), 150)}
              placeholder="e.g. Europe/Berlin"
              className="text-sm"
            />
            {showTzDropdown && (
              <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-slate-200 rounded-md shadow-lg max-h-52 overflow-y-auto">
                <button type="button" onMouseDown={() => { setTimezone(''); setTzSearch(''); setShowTzDropdown(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:bg-slate-50 border-b border-slate-100 italic">
                  — Use club default —
                </button>
                {(typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl
                  ? (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
                  : ['Europe/Berlin', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC']
                )
                  .filter(tz => !tzSearch || tz.toLowerCase().includes(tzSearch.toLowerCase()))
                  .slice(0, 50)
                  .map(tz => (
                    <button key={tz} type="button" onMouseDown={() => { setTimezone(tz); setTzSearch(''); setShowTzDropdown(false) }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${tz === timezone ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'}`}>
                      {tz}
                    </button>
                  ))}
              </div>
            )}
          </div>
          {timezone && <p className="text-xs text-slate-400">Current time: {new Date().toLocaleTimeString('de-DE', { timeZone: timezone })}</p>}
        </div>

        <Button disabled={saving || !name.trim()} onClick={handleSave} className="gap-1.5">
          {saved ? <><Check className="w-3.5 h-3.5" />Saved</> : saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Club Settings */}
      <div className="mt-10 pt-6 border-t border-slate-200">
        <h2 className="text-base font-semibold text-slate-900 mb-6">Club Settings</h2>

        <h3 className="text-sm font-medium text-slate-700 mb-3">Members</h3>
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
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
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
  )
}