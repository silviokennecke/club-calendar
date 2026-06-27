import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiDelete } from '@/lib/api'
import type { EventTemplate } from '@/lib/types'
import { formatAddress } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { SectionHeader, EmptyState, TagBadge } from '@/components/ui/shared'
import { Plus, Pencil, Trash2, Clock, MapPin } from 'lucide-react'
import TemplateModal from '@/components/templates/TemplateModal'

export default function TemplatesPage() {
  const { calendarId } = useParams<{ calendarId: string }>()
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null)

  const { data: templates = [] } = useQuery<EventTemplate[]>({
    queryKey: ['templates', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/templates`),
  })

  async function handleDelete(id: string) {
    await apiDelete(`/api/calendars/${calendarId}/templates/${id}`)
    qc.invalidateQueries({ queryKey: ['templates', calendarId] })
  }

  function openCreate() { setEditingTemplate(null); setModalOpen(true) }
  function openEdit(t: EventTemplate) { setEditingTemplate(t); setModalOpen(true) }

  return (
    <div className="p-6 max-w-3xl">
      <SectionHeader
        title="Event Templates"
        description="Templates pre-fill event details and can be used to create series of events."
        action={<Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Template</Button>}
      />

      {templates.length === 0 ? (
        <EmptyState message="No templates yet. Create one to speed up event creation." />
      ) : (
        <div className="space-y-3">
          {templates.map(t => (
            <div key={t.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-medium text-slate-900">{t.name}</h3>
                  <div className="flex items-center gap-3 mt-1.5 text-sm text-slate-500">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{t.timeBegin}–{t.timeEnd}</span>
                    {t.location && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{t.location.name ?? formatAddress(t.location)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(t)} className="text-slate-400 hover:text-slate-600 p-1.5 rounded"><Pencil className="w-3.5 h-3.5" /></button>
                  <AlertDialog>
                    <AlertDialogTrigger render={<button className="text-slate-400 hover:text-red-500 p-1.5 rounded" />}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete template?</AlertDialogTitle>
                        <AlertDialogDescription>Events created from this template won&apos;t be affected.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(t.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {t.properties.map(p => <TagBadge key={p.property.id} label={p.property.name} icon={p.property.icon} variant="slate" />)}
                {t.features.map(f => <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />)}
                {t.targetGroups.map(tg => <TagBadge key={tg.targetGroup.id} label={tg.targetGroup.name} variant="purple" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateModal
        calendarId={calendarId!}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTemplate(null) }}
        template={editingTemplate}
      />
    </div>
  )
}
