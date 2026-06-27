import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { FullPageLoader } from '@/components/ui/shared'
import type { Club } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export default function ClubsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [redirected, setRedirected] = useState(false)
  const [newClubName, setNewClubName] = useState('')
  const [open, setOpen] = useState(false)

  const { data: clubs = [], isLoading, refetch } = useQuery({
    queryKey: ['clubs'],
    queryFn: () => apiGet<Club[]>('/api/clubs'),
  })

  useEffect(() => {
    if (isLoading || redirected) return
    if (user?.lastClubId && user?.lastCalendarId) {
      const clubExists = clubs.some(c => c.id === user.lastClubId)
      if (clubs.length > 0 && clubExists) {
        setRedirected(true)
        navigate(`/clubs/${user.lastClubId}/calendars/${user.lastCalendarId}`, { replace: true })
        return
      }
    }
    if (!isLoading && clubs.length === 0) {
      setRedirected(true)
      navigate('/setup', { replace: true })
    }
  }, [user, clubs, isLoading, redirected, navigate])

  async function handleCreate() {
    if (!newClubName.trim()) return
    await apiPost('/api/clubs', { name: newClubName, timezone: 'Europe/Berlin' })
    setNewClubName('')
    setOpen(false)
    refetch()
  }

  if (isLoading || redirected) return <FullPageLoader />

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <span className="text-lg font-semibold text-slate-900">📅 Club Calendar</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </div>
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Select a Club</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>+ New Club</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Club</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input placeholder="Club name" value={newClubName}
                  onChange={e => setNewClubName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} />
                <Button className="w-full" onClick={handleCreate}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map(club => (
            <Card key={club.id} className="border-slate-200">
              <CardHeader className="pb-2"><CardTitle className="text-base">{club.name}</CardTitle></CardHeader>
              <CardContent><p className="text-xs text-slate-500">{club.timezone}</p></CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
