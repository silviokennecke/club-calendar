import { useParams } from 'react-router-dom'
import ResourceManager from '@/components/settings/ResourceManager'

export default function FeaturesPage() {
  const params = useParams<{ calendarId: string }>()
  const calendarId = params.calendarId!
  const path = `/api/calendars/${calendarId}/features`
  return (
    <div className="p-6 max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">Features are special activities or offerings at an event (e.g. Bonusschießen).</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={['features', calendarId]}
        title="Features"
        fields={[{ key: 'name', label: 'Name', placeholder: 'Feature name' }]}
        renderItem={item => <span className="text-sm font-medium text-slate-800">{String(item.name)}</span>}
      />
    </div>
  )
}
