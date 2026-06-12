'use client'
import { useQuery } from '@tanstack/react-query'
import { apiGet, apiPost } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { Club } from '@/lib/types'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export default function ClubsPage() {
  const { user, logout } = useAuth()
  const [newClubName, setNewClubName] = useState('')
  const [open, setOpen] = useState(false)
  const { data: clubs = [], refetch } = useQuery({
    queryKey: ['clubs'],
    queryFn: () => apiGet<Club[]>('/api/clubs'),
  })

  async function handleCreate() {
    if (!newClubName.trim()) return
    await apiPost('/api/clubs', { name: newClubName, timezone: 'Europe/Berlin' })
    setNewClubName('')
    setOpen(false)
    refetch()
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-slate-900">Club Calendar</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-slate-900">My Clubs</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              + New Club
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Club</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder="Club name"
                  value={newClubName}
                  onChange={e => setNewClubName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreate()}
                />
                <Button className="w-full" onClick={handleCreate}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {clubs.length === 0 ? (
          <div className="text-center py-16 text-slate-400">No clubs yet. Create your first one.</div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {clubs.map(club => (
              <Link key={club.id} href={`/clubs/${club.id}`}>
                <Card className="hover:shadow-md transition-all cursor-pointer border-slate-200 hover:border-blue-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{club.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-slate-500">{club.timezone}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
