'use client'
import { use, useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '@/lib/api'
import type { Calendar } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from 'lucide-react'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function CalendarSettingsPage({ params }: Props) {
  const { clubId, calendarId } = use(params)
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: calendar } = useQuery({
    queryKey: ['calendar', calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  })
  useEffect(() => { if (calendar) setName(calendar.name) }, [calendar])

  async function handleSave() {
    setSaving(true)
    try {
      await apiPatch(`/api/clubs/${clubId}/calendars/${calendarId}`, { name })
      qc.invalidateQueries({ queryKey: ['calendar', calendarId] })
      qc.invalidateQueries({ queryKey: ['calendars', clubId] })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-6">General Settings</h2>
      <div className="space-y-4 bg-white rounded-xl border border-slate-200 p-5">
        <div className="space-y-1.5">
          <Label>Calendar Name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </div>
        <Button disabled={saving || !name.trim()} onClick={handleSave} className="gap-1.5">
          {saved ? <><Check className="w-3.5 h-3.5" />Saved</> : saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
