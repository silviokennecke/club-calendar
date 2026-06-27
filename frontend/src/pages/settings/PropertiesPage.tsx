import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ResourceManager from '@/components/settings/ResourceManager'

export default function PropertiesPage() {
  const { t } = useTranslation()
  const params = useParams<{ calendarId: string }>()
  const calendarId = params.calendarId!
  const path = `/api/calendars/${calendarId}/properties`
  return (
    <div className="p-6 max-w-2xl">
      <p className="text-sm text-slate-500 mb-6">{t('settings.properties.description')}</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={['properties', calendarId]}
        title={t('settings.properties.title')}
        emptyMessage={t('settings.properties.noProperties')}
        deleteTitle={t('settings.properties.deleteProperty')}
        deleteDescription={t('settings.properties.cannotBeUndone')}
        fields={[
          { key: 'icon', label: t('settings.properties.icon'), placeholder: '🎯', type: 'emoji' },
          { key: 'name', label: t('common.name'), placeholder: 'Property name' },
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
