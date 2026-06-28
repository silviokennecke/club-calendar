import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { CalendarFeed, TargetGroup } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FormField, SectionHeader, EmptyState, TagBadge } from "@/components/ui/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Plus, Copy, Eye, EyeOff, RefreshCw, Pencil, Trash2, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

function icsUrl(feedId: string, secret?: string) {
  const base = `${API_URL}/api/feed/${feedId}/ics`;
  return secret ? `${base}?secret=${secret}` : base;
}
function webcalUrl(feedId: string, secret?: string) {
  return icsUrl(feedId, secret).replace(/^https?:/, "webcal:");
}
function feedWebUrl(feedId: string, secret?: string) {
  const base = window.location.origin;
  return secret ? `${base}/feed/${feedId}?secret=${secret}` : `${base}/feed/${feedId}`;
}

interface FeedFormData {
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  targetGroupIds: string[];
}

export default function FeedsPage() {
  const { t } = useTranslation();
  const { calendarId } = useParams<{ calendarId: string }>();
  const qc = useQueryClient();

  const { data: feeds = [] } = useQuery<CalendarFeed[]>({
    queryKey: ["feeds", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/feeds`),
  });
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFeed, setEditingFeed] = useState<CalendarFeed | null>(null);
  const [form, setForm] = useState<FeedFormData>({
    name: "",
    visibility: "PRIVATE",
    targetGroupIds: [],
  });
  const [saving, setSaving] = useState(false);
  const [secretVisible, setSecretVisible] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  function openCreate() {
    setEditingFeed(null);
    setForm({ name: "", visibility: "PRIVATE", targetGroupIds: [] });
    setDialogOpen(true);
  }

  function openEdit(feed: CalendarFeed) {
    setEditingFeed(feed);
    setForm({
      name: feed.name,
      visibility: feed.visibility,
      targetGroupIds: feed.targetGroups.map((t) => t.targetGroupid),
    });
    setDialogOpen(true);
  }

  function toggleTargetGroup(id: string) {
    setForm((f) => ({
      ...f,
      targetGroupIds: f.targetGroupIds.includes(id)
        ? f.targetGroupIds.filter((x) => x !== id)
        : [...f.targetGroupIds, id],
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (editingFeed) {
        await apiPatch(`/api/calendars/${calendarId}/feeds/${editingFeed.id}`, form);
      } else {
        await apiPost(`/api/calendars/${calendarId}/feeds`, form);
      }
      qc.invalidateQueries({ queryKey: ["feeds", calendarId] });
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await apiDelete(`/api/calendars/${calendarId}/feeds/${id}`);
    qc.invalidateQueries({ queryKey: ["feeds", calendarId] });
  }

  async function handleRegenerate(id: string) {
    await apiPost(`/api/calendars/${calendarId}/feeds/${id}/regenerate-secret`, {});
    qc.invalidateQueries({ queryKey: ["feeds", calendarId] });
  }

  function copyToClipboard(text: string, feedId: string) {
    navigator.clipboard.writeText(text);
    setCopied(feedId);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="max-w-3xl p-6">
      <SectionHeader
        title={t("settings.feeds.title")}
        description={t("settings.feeds.description")}
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("settings.feeds.newFeed")}
          </Button>
        }
      />

      {feeds.length === 0 ? (
        <EmptyState message={t("settings.feeds.noFeeds")} />
      ) : (
        <div className="space-y-4">
          {feeds.map((feed) => {
            const url = icsUrl(
              feed.id,
              feed.visibility === "PRIVATE" ? feed.sharedSecret : undefined,
            );
            const wurl = webcalUrl(
              feed.id,
              feed.visibility === "PRIVATE" ? feed.sharedSecret : undefined,
            );
            const tgNames = feed.targetGroups
              .map((ft) => targetGroups.find((t) => t.id === ft.targetGroupid)?.name)
              .filter(Boolean) as string[];

            return (
              <div
                key={feed.id}
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium text-slate-900">{feed.name}</span>
                      <Badge
                        variant={feed.visibility === "PUBLIC" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {feed.visibility}
                      </Badge>
                    </div>
                    {tgNames.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {tgNames.map((name) => (
                          <TagBadge key={name} label={name} variant="purple" />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(feed)}
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
                          <AlertDialogTitle>{t("settings.feeds.deleteFeed")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("settings.feeds.cannotBeUndone")}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(feed.id)}>
                            {t("common.delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{t("settings.feeds.icsUrl")}</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                      {url}
                    </code>
                    <button
                      onClick={() => copyToClipboard(url, feed.id)}
                      title="Copy URL"
                      className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                    >
                      {copied === feed.id ? (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <a
                      href={wurl}
                      className="text-xs whitespace-nowrap text-blue-600 hover:underline"
                    >
                      {t("settings.feeds.openInApp")}
                    </a>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{t("settings.feeds.webUrl")}</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                      {feedWebUrl(
                        feed.id,
                        feed.visibility === "PRIVATE" ? feed.sharedSecret : undefined,
                      )}
                    </code>
                    <a
                      href={feedWebUrl(
                        feed.id,
                        feed.visibility === "PRIVATE" ? feed.sharedSecret : undefined,
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded border border-slate-200 px-2.5 py-1.5 text-xs text-blue-600 transition-colors hover:bg-slate-50 hover:underline"
                    >
                      {t("settings.feeds.open")}
                    </a>
                  </div>
                </div>

                {feed.visibility === "PRIVATE" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">
                      {t("settings.feeds.sharedSecret")}
                    </Label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">
                        {secretVisible[feed.id]
                          ? feed.sharedSecret
                          : "••••••••••••••••••••••••••••••••••••"}
                      </code>
                      <button
                        onClick={() => setSecretVisible((s) => ({ ...s, [feed.id]: !s[feed.id] }))}
                        title="Toggle visibility"
                        className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                      >
                        {secretVisible[feed.id] ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => handleRegenerate(feed.id)}
                        title="Regenerate secret"
                        className="rounded border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50 hover:text-orange-500"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">
                      {t("settings.feeds.regeneratingWarning")}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => !v && setDialogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingFeed ? t("settings.feeds.editFeed") : t("settings.feeds.newFeed")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <FormField label={t("settings.feeds.feedName")}>
              <Input
                placeholder="e.g. Public Calendar"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FormField>

            <FormField label={t("settings.feeds.visibility")}>
              <div className="flex gap-2">
                {(["PUBLIC", "PRIVATE"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setForm((f) => ({ ...f, visibility: v }))}
                    className={`flex-1 rounded-md border py-2 text-sm transition-colors ${form.visibility === v ? "border-blue-300 bg-blue-50 font-medium text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  >
                    {v === "PUBLIC"
                      ? `🌐 ${t("settings.feeds.public")}`
                      : `🔒 ${t("settings.feeds.private")}`}
                  </button>
                ))}
              </div>
              {form.visibility === "PRIVATE" && (
                <p className="text-xs text-slate-400">{t("settings.feeds.privateSecretInfo")}</p>
              )}
            </FormField>

            {targetGroups.length > 0 && (
              <FormField
                label={
                  <>
                    {t("settings.feeds.targetGroups")}{" "}
                    <span className="font-normal text-slate-400">
                      ({t("settings.feeds.allGroups")})
                    </span>
                  </>
                }
              >
                <div className="flex flex-wrap gap-1.5">
                  {targetGroups.map((tg) => (
                    <button
                      key={tg.id}
                      type="button"
                      onClick={() => toggleTargetGroup(tg.id)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${form.targetGroupIds.includes(tg.id) ? "border-purple-300 bg-purple-100 text-purple-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                    >
                      {tg.name}
                    </button>
                  ))}
                </div>
              </FormField>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={saving || !form.name.trim()} onClick={handleSave}>
              {saving
                ? t("settings.feeds.saving")
                : editingFeed
                  ? t("common.save")
                  : t("settings.feeds.createFeed")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
