import { useParams } from 'react-router-dom'
import ResourceManager from '@/components/settings/ResourceManager'

export default function TargetGroupsPage() {
  const params = useParams<{ calendarId: string }>()
  const calendarId = params.calendarId!
  const path = `/api/calendars/${calendarId}/target-groups`
  return (
    <div className="p-6 max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">Target groups define audience segments (e.g. Jugend, Erwachsene). Used to filter calendar feeds.</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={['targetGroups', calendarId]}
        title="Target Groups"
        fields={[{ key: 'name', label: 'Name', placeholder: 'Group name' }]}
        renderItem={item => <span className="text-sm font-medium text-slate-800">{String(item.name)}</span>}
      />
    </div>
  )
}
