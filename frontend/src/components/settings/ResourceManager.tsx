import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Pencil, Trash2, Plus, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmojiPicker } from "@/components/ui/shared";
interface Field {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "emoji";
}

interface Item {
  id: number;
  [key: string]: unknown;
}

interface Props {
  calendarId: string;
  resourcePath: string; // e.g. `/api/calendars/${calendarId}/properties`
  queryKey: string[];
  fields: Field[];
  title: string;
  emptyMessage?: string;
  deleteTitle?: string;
  deleteDescription?: string;
  renderItem: (item: Item) => React.ReactNode;
}

export default function ResourceManager({
  calendarId: _calendarId,
  resourcePath,
  queryKey,
  fields,
  title,
  emptyMessage,
  deleteTitle,
  deleteDescription,
  renderItem,
}: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: items = [] } = useQuery<Item[]>({ queryKey, queryFn: () => apiGet(resourcePath) });

  const [creating, setCreating] = useState(false);
  const [createValues, setCreateValues] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    setSaving(true);
    try {
      await apiPost(resourcePath, createValues);
      qc.invalidateQueries({ queryKey });
      setCreating(false);
      setCreateValues({});
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(id: number) {
    setSaving(true);
    try {
      await apiPatch(`${resourcePath}/${id}`, editValues);
      qc.invalidateQueries({ queryKey });
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    await apiDelete(`${resourcePath}/${id}`);
    qc.invalidateQueries({ queryKey });
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    const vals: Record<string, string> = {};
    fields.forEach((f) => {
      vals[f.key] = String(item[f.key] ?? "");
    });
    setEditValues(vals);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <Button
          size="sm"
          onClick={() => {
            setCreating(true);
            setCreateValues({});
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("common.add")}
        </Button>
      </div>

      {creating && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            {fields.map((f) =>
              f.type === "emoji" ? (
                <EmojiPicker
                  key={f.key}
                  className="w-full"
                  label={f.label}
                  value={createValues[f.key] ?? ""}
                  onChange={(val) => setCreateValues((v) => ({ ...v, [f.key]: val }))}
                />
              ) : (
                <Input
                  key={f.key}
                  className="min-w-32 flex-1"
                  placeholder={f.placeholder ?? f.label}
                  value={createValues[f.key] ?? ""}
                  onChange={(e) => setCreateValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              ),
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
              <X className="mr-1 h-3.5 w-3.5" />
              {t("common.cancel")}
            </Button>
            <Button size="sm" disabled={saving} onClick={handleCreate}>
              <Check className="mr-1 h-3.5 w-3.5" />
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 && !creating ? (
        <p className="py-6 text-center text-sm text-slate-400">
          {emptyMessage ?? `No ${title.toLowerCase()} yet. Add one to get started.`}
        </p>
      ) : (
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              {editingId === item.id ? (
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {fields.map((f) =>
                      f.type === "emoji" ? (
                        <EmojiPicker
                          key={f.key}
                          className="w-full"
                          label={f.label}
                          value={editValues[f.key] ?? ""}
                          onChange={(val) => setEditValues((v) => ({ ...v, [f.key]: val }))}
                        />
                      ) : (
                        <Input
                          key={f.key}
                          className="h-9 min-w-32 flex-1"
                          value={editValues[f.key] ?? ""}
                          placeholder={f.placeholder ?? f.label}
                          onChange={(e) =>
                            setEditValues((v) => ({ ...v, [f.key]: e.target.value }))
                          }
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate(item.id)}
                        />
                      ),
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={saving} onClick={() => handleUpdate(item.id)}>
                      <Check className="mr-1 h-3.5 w-3.5" />
                      {t("common.save")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1">{renderItem(item)}</div>
                  <button
                    onClick={() => startEdit(item)}
                    className="p-1 text-slate-400 hover:text-slate-600"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<button className="p-1 text-slate-400 hover:text-red-500" />}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{deleteTitle ?? t("common.delete")}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {deleteDescription ?? t("common.deleteWarning")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(item.id)}>
                          {t("common.delete")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
