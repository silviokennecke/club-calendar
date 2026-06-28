import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";
import type { CalendarEvent, TargetGroup } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { Button } from "@/components/ui/button";
import { EmptyState, TagBadge, SearchInput } from "@/components/ui/shared";
import EventModal from "@/components/calendar/EventModal";
import { Eye, EyeOff, CheckSquare, Trash2, X } from "lucide-react";

type StatusFilter = "all" | "draft" | "published";

export default function EventsListPage() {
  const { t } = useTranslation();
  const { calendarId } = useParams<{ calendarId: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulking, setBulking] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  const { data: allEvents = [], isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["events-list", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/events`),
  });
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  });

  void targetGroups;

  const filtered = useMemo(() => {
    let list = allEvents;
    if (statusFilter === "draft") list = list.filter((e) => e.isDraft);
    else if (statusFilter === "published") list = list.filter((e) => !e.isDraft);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return list;
  }, [allEvents, statusFilter, search]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const d = a.date.localeCompare(b.date);
        return d !== 0 ? d : a.timeBegin.localeCompare(b.timeBegin);
      }),
    [filtered],
  );

  const allFilteredSelected = sorted.length > 0 && sorted.every((e) => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        sorted.forEach((e) => next.delete(e.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        sorted.forEach((e) => next.add(e.id));
        return next;
      });
    }
  }

  async function bulkDelete() {
    const ids = sorted.filter((e) => selectedIds.has(e.id)).map((e) => e.id);
    if (ids.length === 0) return;
    if (!confirm(t("events.deleteConfirm", { count: ids.length }))) return;
    setBulking(true);
    try {
      await Promise.all(ids.map((id) => apiDelete(`/api/calendars/${calendarId}/events/${id}`)));
      qc.invalidateQueries({ queryKey: ["events-list", calendarId] });
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
      setSelectedIds(new Set());
    } finally {
      setBulking(false);
    }
  }

  async function bulkSetDraft(isDraft: boolean) {
    const ids = sorted.filter((e) => selectedIds.has(e.id)).map((e) => e.id);
    if (ids.length === 0) return;
    setBulking(true);
    try {
      await Promise.all(
        ids.map((id) => apiPatch(`/api/calendars/${calendarId}/events/${id}`, { isDraft })),
      );
      qc.invalidateQueries({ queryKey: ["events-list", calendarId] });
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
      setSelectedIds(new Set());
    } finally {
      setBulking(false);
    }
  }

  const draftCount = allEvents.filter((e) => e.isDraft).length;
  const publishedCount = allEvents.filter((e) => !e.isDraft).length;

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-slate-900">{t("events.title")}</h1>
        <SearchInput value={search} onChange={setSearch} placeholder={t("events.search")} />
      </div>

      <div className="mb-4 flex w-fit items-center gap-1 rounded-lg bg-slate-100 p-1">
        {(
          [
            ["all", t("events.allTab", { count: allEvents.length })],
            ["published", t("events.publishedTab", { count: publishedCount })],
            ["draft", t("events.draftTab", { count: draftCount })],
          ] as [StatusFilter, string][]
        ).map(([val, label]) => (
          <button
            key={val}
            onClick={() => {
              setStatusFilter(val);
              setSelectedIds(new Set());
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === val ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {someSelected && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-medium text-blue-800">
            {t("events.selectedCount", { count: selectedIds.size })}
          </span>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={bulking}
              onClick={() => bulkSetDraft(false)}
              className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
            >
              <Eye className="h-3.5 w-3.5" />
              {t("events.publish")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulking}
              onClick={() => bulkSetDraft(true)}
              className="gap-1.5 border-slate-300 text-slate-600 hover:bg-slate-50"
            >
              <EyeOff className="h-3.5 w-3.5" />
              {t("events.markAsDraft")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulking}
              onClick={bulkDelete}
              className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common.delete")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              className="text-slate-400"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-12 text-center text-sm text-slate-400">{t("events.loadingEvents")}</div>
      ) : sorted.length === 0 ? (
        <EmptyState
          message={
            search
              ? t("events.noSearchResults")
              : statusFilter === "published"
                ? t("events.noPublished")
                : statusFilter === "draft"
                  ? t("events.noDraft")
                  : t("events.noEvents")
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[2rem_1fr_7rem_5rem_5rem_auto_5.5rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-500">
            <button
              onClick={toggleAll}
              className={`flex items-center justify-center ${allFilteredSelected ? "text-blue-600" : "text-slate-400 hover:text-slate-600"}`}
            >
              <CheckSquare className="h-4 w-4" />
            </button>
            <span>{t("events.colName")}</span>
            <span>{t("events.colDate")}</span>
            <span>{t("events.colStart")}</span>
            <span>{t("events.colEnd")}</span>
            <span>{t("events.colTags")}</span>
            <span>{t("events.colStatus")}</span>
          </div>

          <div className="divide-y divide-slate-100">
            {sorted.map((ev) => {
              const isSel = selectedIds.has(ev.id);
              const iconPrefix = ev.properties
                .map((p) => p.property.icon)
                .filter(Boolean)
                .join("");
              const tgNames = ev.targetGroups.map((t) => t.targetGroup.name);

              return (
                <div
                  key={ev.id}
                  className={`grid cursor-pointer grid-cols-[2rem_1fr_7rem_5rem_5rem_auto_5.5rem] items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isSel ? "bg-blue-50/50" : "hover:bg-slate-50"}`}
                  onClick={() => setEditingEvent(ev)}
                >
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(ev.id);
                    }}
                    className={`flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded border transition-colors ${isSel ? "border-blue-600 bg-blue-600" : "border-slate-300 hover:border-blue-400"}`}
                  >
                    {isSel && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>

                  <span className="truncate font-medium text-slate-800">
                    {iconPrefix && <span className="mr-1">{iconPrefix}</span>}
                    {ev.name}
                    {ev.location && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        @ {ev.location.name ?? formatAddress(ev.location)}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-slate-500">
                    {ev.dateEnd && ev.dateEnd.slice(0, 10) !== ev.date.slice(0, 10)
                      ? `${formatDate(ev.date, dateFormat)} – ${formatDate(ev.dateEnd, dateFormat)}`
                      : formatDate(ev.date, dateFormat)}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {ev.isAllDay ? "—" : ev.timeBegin}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {ev.isAllDay ? t("events.allDay") : ev.timeEnd}
                  </span>

                  <div className="flex flex-wrap gap-1">
                    {tgNames.map((n) => (
                      <TagBadge key={n} label={n} variant="purple" />
                    ))}
                    {ev.features.map((f) => (
                      <TagBadge key={f.feature.id} label={f.feature.name} variant="green" />
                    ))}
                  </div>

                  <span
                    className={`justify-self-start rounded-full px-2 py-0.5 text-xs font-medium ${ev.isDraft ? "bg-slate-100 text-slate-500" : "bg-green-100 text-green-700"}`}
                  >
                    {ev.isDraft ? t("events.draftStatus") : t("events.publishedStatus")}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sorted.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          {search || statusFilter !== "all"
            ? t("events.countFiltered", { count: sorted.length })
            : t("events.count", { count: sorted.length })}
        </p>
      )}

      <EventModal
        calendarId={calendarId!}
        open={editingEvent !== null}
        onClose={() => {
          setEditingEvent(null);
          qc.invalidateQueries({ queryKey: ["events-list", calendarId] });
        }}
        event={editingEvent}
      />
    </div>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className}>
      <path
        d="M2 6l3 3 5-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
