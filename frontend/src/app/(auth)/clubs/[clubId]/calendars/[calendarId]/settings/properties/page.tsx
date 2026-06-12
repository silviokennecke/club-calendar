'use client'
import { use } from 'react'
import ResourceManager from '@/components/settings/ResourceManager'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function PropertiesPage({ params }: Props) {
  const { calendarId } = use(params)
  const path = `/api/calendars/${calendarId}/properties`
  return (
    <div className="p-6 max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">Properties are tags shown on events (e.g. dress code, equipment). They can have an emoji icon.</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={['properties', calendarId]}
        title="Properties"
        fields={[
          { key: 'icon', label: 'Icon', placeholder: '🎯', type: 'emoji' },
          { key: 'name', label: 'Name', placeholder: 'Property name' },
        ]}
        renderItem={item => (
          <div className="flex items-center gap-2">
            {!!item.icon && <span className="text-lg">{String(item.icon)}</span>}
            <span className="text-sm font-medium text-slate-800">{String(item.name)}</span>
          </div>
        )}
      />
    </div>
  )
}
