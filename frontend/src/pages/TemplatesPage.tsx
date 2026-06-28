import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiDelete } from "@/lib/api";
import type { EventTemplate } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SectionHeader, EmptyState, TagBadge } from "@/components/ui/shared";
import { Plus, Pencil, Trash2, Clock, MapPin } from "lucide-react";
import TemplateModal from "@/components/templates/TemplateModal";
import { useTranslation } from "react-i18next";

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { calendarId } = useParams<{ calendarId: string }>();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EventTemplate | null>(null);

  const { data: templates = [] } = useQuery<EventTemplate[]>({
    queryKey: ["templates", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/templates`),
  });

  async function handleDelete(id: string) {
    await apiDelete(`/api/calendars/${calendarId}/templates/${id}`);
    qc.invalidateQueries({ queryKey: ["templates", calendarId] });
  }

  function openCreate() {
    setEditingTemplate(null);
    setModalOpen(true);
  }
  function openEdit(tmpl: EventTemplate) {
    setEditingTemplate(tmpl);
    setModalOpen(true);
  }

  return (
    <div className="max-w-3xl p-6">
      <SectionHeader
        title={t("templates.title")}
        description={t("templates.description")}
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("templates.newTemplate")}
          </Button>
        }
      />

      {templates.length === 0 ? (
        <EmptyState message={t("templates.noTemplates")} />
      ) : (
        <div className="space-y-3">
          {templates.map((tmpl) => (
            <div key={tmpl.id} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-slate-900">{tmpl.name}</h3>
                  <div className="mt-1.5 flex items-center gap-3 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {tmpl.timeBegin}–{tmpl.timeEnd}
                    </span>
                    {tmpl.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {tmpl.location.name ?? formatAddress(tmpl.location)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEdit(tmpl)}
                    className="rounded p-1.5 text-slate-400 hover:text-slate-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <button className="rounded p-1.5 text-slate-400 hover:text-red-500" />
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t("templates.deleteTemplate")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("templates.deleteTemplateInfo")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(tmpl.id)}>
                          {t("common.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {tmpl.properties.map((p) => (
                  <TagBadge
                    key={p.property.id}
                    label={p.property.name}
                    icon={p.property.icon}
                    variant="slate"
                  />
                ))}
                {tmpl.features.map((f) => (
                  <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />
                ))}
                {tmpl.targetGroups.map((tg) => (
                  <TagBadge key={tg.targetGroup.id} label={tg.targetGroup.name} variant="purple" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateModal
        calendarId={calendarId!}
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingTemplate(null);
        }}
        template={editingTemplate}
      />
    </div>
  );
}
