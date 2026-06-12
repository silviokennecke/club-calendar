'use client'
import { use, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiDelete } from '@/lib/api'
import type { EventTemplate } from '@/lib/types'
import { formatAddress } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { Plus, Pencil, Trash2, Clock, MapPin } from 'lucide-react'
import TemplateModal from '@/components/templates/TemplateModal'

interface Props { params: Promise<{ clubId: string; calendarId: string }> }

export default function TemplatesPage({ params }: Props) {
  const { calendarId } = use(params)
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null)

  const { data: templates = [] } = useQuery<EventTemplate[]>({
    queryKey: ['templates', calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/templates`),
  })

  async function handleDelete(id: number) {
    await apiDelete(`/api/calendars/${calendarId}/templates/${id}`)
    qc.invalidateQueries({ queryKey: ['templates', calendarId] })
  }

  function openCreate() { setEditingTemplate(null); setModalOpen(true) }
  function openEdit(t: EventTemplate) { setEditingTemplate(t); setModalOpen(true) }

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Event Templates</h2>
          <p className="text-sm text-slate-500 mt-0.5">Templates pre-fill event details and can be used to create series of events.</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus className="w-3.5 h-3.5 mr-1" />New Template</Button>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          No templates yet. Create one to speed up event creation.
        </div>
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
                        <AlertDialogDescription>Events created from this template won't be affected.</AlertDialogDescription>
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
                {t.properties.map(p => (
                  <Badge key={p.property.id} variant="secondary" className="text-xs">
                    {p.property.icon && <span className="mr-1">{p.property.icon}</span>}{p.property.name}
                  </Badge>
                ))}
                {t.features.map(f => (
                  <Badge key={f.feature.id} variant="outline" className="text-xs text-green-700 border-green-200 bg-green-50">
                    {f.feature.name}
                  </Badge>
                ))}
                {t.targetGroups.map(tg => (
                  <Badge key={tg.targetGroup.id} variant="outline" className="text-xs text-purple-700 border-purple-200 bg-purple-50">
                    {tg.targetGroup.name}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateModal
        calendarId={calendarId}
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingTemplate(null) }}
        template={editingTemplate}
      />
    </div>
  )
}
