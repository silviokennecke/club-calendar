'use client'
import { use } from 'react'
import ResourceManager from '@/components/settings/ResourceManager'
import { MapPin } from 'lucide-react'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function LocationsPage({ params }: Props) {
  const { calendarId } = use(params)
  const path = `/api/calendars/${calendarId}/locations`
  return (
    <div className="p-6 max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">Locations can be assigned to events and templates as the default venue.</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={['locations', calendarId]}
        title="Locations"
        fields={[{ key: 'address', label: 'Address', placeholder: 'Street, City' }]}
        renderItem={item => (
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="text-sm text-slate-800">{String(item.address)}</span>
          </div>
        )}
      />
    </div>
  )
}
