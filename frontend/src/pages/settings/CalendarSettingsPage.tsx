import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPatch } from '@/lib/api'
import type { Calendar } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Check } from 'lucide-react'
import { FormField } from '@/components/ui/shared'

export default function CalendarSettingsPage() {
  const { clubId, calendarId } = useParams<{ clubId: string; calendarId: string }>()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [timezone, setTimezone] = useState('')
  const [tzSearch, setTzSearch] = useState('')
  const [showTzDropdown, setShowTzDropdown] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

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

  async function handleSave() {
    setSaving(true)
    try {
      await apiPatch(`/api/clubs/${clubId}/calendars/${calendarId}`, { name, timezone: timezone || null })
      qc.invalidateQueries({ queryKey: ['calendar', calendarId] })
      qc.invalidateQueries({ queryKey: ['calendars', clubId] })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="p-6 max-w-lg">
      <h2 className="text-base font-semibold text-slate-900 mb-6">General Settings</h2>
      <div className="space-y-4 bg-white rounded-xl border border-slate-200 p-5">
        <FormField label="Calendar Name">
          <Input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </FormField>

        <FormField label={<>Timezone <span className="text-slate-400 font-normal">(overrides club default)</span></>}>
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
        </FormField>

        <Button disabled={saving || !name.trim()} onClick={handleSave} className="gap-1.5">
          {saved ? <><Check className="w-3.5 h-3.5" />Saved</> : saving ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
