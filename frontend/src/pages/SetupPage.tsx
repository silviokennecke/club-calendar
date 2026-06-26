import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { Club, Calendar } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CalendarDays, Building2, Check } from 'lucide-react'

export default function SetupPage() {
  const { updateUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const clubIdParam = searchParams.get('clubId')

  const [step, setStep] = useState<1 | 2>(1)
  const [clubName, setClubName] = useState('')
  const [calendarName, setCalendarName] = useState('')
  const [createdClub, setCreatedClub] = useState<Club | null>(null)
  const [loading, setLoading] = useState(false)

  const { data: paramClub, isLoading: paramClubLoading } = useQuery<Club>({
    queryKey: ['club', clubIdParam],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubIdParam}`),
    enabled: !!clubIdParam,
    retry: false,
  })

  const { data: existingClubs = [], isLoading: existingClubsLoading } = useQuery<Club[]>({
    queryKey: ['clubs'],
    queryFn: () => apiGet<Club[]>('/api/clubs'),
    enabled: !clubIdParam,
  })

  const detecting = clubIdParam ? paramClubLoading : existingClubsLoading

  useEffect(() => {
    if (detecting) return
    const club = clubIdParam ? (paramClub ?? null) : (existingClubs[0] ?? null)
    if (!club) return
    setCreatedClub(club)
    setCalendarName(club.name + ' Calendar')
    setStep(2)
  }, [detecting]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateClub() {
    if (!clubName.trim()) return
    setLoading(true)
    try {
      const club = await apiPost<Club>('/api/clubs', { name: clubName.trim(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin' })
      setCreatedClub(club)
      setCalendarName(clubName.trim() + ' Calendar')
      setStep(2)
    } finally { setLoading(false) }
  }

  async function handleCreateCalendar() {
    if (!calendarName.trim() || !createdClub) return
    setLoading(true)
    try {
      const calendar = await apiPost<Calendar>(`/api/clubs/${createdClub.id}/calendars`, { name: calendarName.trim() })
      await updateUser({ lastClubId: createdClub.id, lastCalendarId: calendar.id })
      navigate(`/clubs/${createdClub.id}/calendars/${calendar.id}`, { replace: true })
    } finally { setLoading(false) }
  }

  if (detecting) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            {step > 1 ? <Check className="w-4 h-4" /> : '1'}
          </div>
          <div className={`flex-1 h-0.5 ${step > 1 ? 'bg-blue-600' : 'bg-slate-200'}`} />
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
            2
          </div>
        </div>

        {step === 1 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-5">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Welcome to Club Calendar</h1>
            <p className="text-sm text-slate-500 mb-6">Let&apos;s set up your club first.</p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Club name</Label>
                <Input
                  placeholder="e.g. Schützenverein Musterstadt"
                  value={clubName}
                  onChange={e => setClubName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateClub()}
                  autoFocus
                />
              </div>
              <Button className="w-full" disabled={loading || !clubName.trim()} onClick={handleCreateClub}>
                {loading ? 'Creating…' : 'Create club →'}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-5">
              <CalendarDays className="w-6 h-6 text-green-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mb-1">Create your first calendar</h1>
            <p className="text-sm text-slate-500 mb-6">For <strong>{createdClub?.name}</strong></p>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Calendar name</Label>
                <Input
                  value={calendarName}
                  onChange={e => setCalendarName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateCalendar()}
                  autoFocus
                />
              </div>
              <Button className="w-full" disabled={loading || !calendarName.trim()} onClick={handleCreateCalendar}>
                {loading ? 'Creating…' : 'Get started →'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
