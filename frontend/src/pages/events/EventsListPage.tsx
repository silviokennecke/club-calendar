import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import {
  countByStatus,
  emptyKind,
  filterEvents,
  formatShortDate,
  joinList,
  parseStatusTab,
  STATUS_TABS,
  summarizeSelection,
  type StatusTab,
} from "@/lib/events";
import type { TargetGroup } from "@/lib/types";
import { openModalState, type ModalNavState } from "@/lib/modalRoutes";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  FilterPillGroup,
  LinkButton,
  SearchInput,
  Skeleton,
  SplitButton,
  toast,
} from "@/components/ui/shared";
import { EventsTable } from "@/components/events/EventsTable";
import { useAllEvents, useEventPage } from "@/components/events/useEventPage";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { useLocale } from "@/components/calendar/useLocale";
import { preloadEventModals } from "../lazy";

/** Names in the bulk delete dialog; more are summarized ("und 3 weitere"). */
const MAX_NAMED = 5;

/**
 * All events of a calendar (design: Events, EventsStates, EventsMobile): status tabs with
 * counters, search, audience filter, month groups, multi-select with bulk actions.
 * Tab and search live in the URL (?status=draft&q=…).
 */
export default function EventsListPage() {
  useEffect(preloadEventModals, []);
  const page = useEventPage();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = parseStatusTab(params.get("status"));
  const query = params.get("q") ?? "";
  const latestParams = useRef(params);
  useEffect(() => {
    latestParams.current = params;
  }, [params]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const events = useAllEvents(page.calendarId);
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", page.calendarId],
    queryFn: () => apiGet(`/api/calendars/${page.calendarId}/target-groups`),
  });
  const all = useMemo(() => events.data ?? [], [events.data]);
  const filter = { tab, query, groupIds };
  const shown = useMemo(
    () => filterEvents(all, { tab, query, groupIds }),
    [all, tab, query, groupIds],
  );
  const counts = countByStatus(all, { query, groupIds });
  const canEdit = !!page.calendar && !page.isArchived;
  const selectedEvents = shown.filter((e) => selected.has(e.id));
  const groupList = groups.data ?? [];
  const toneOf = (id: string) => audienceTone(groupList.findIndex((g) => g.id === id));
  // Event dialogs open above this list (with its tab, search and filter).
  const modalState = openModalState(location);

  function setParam(key: "status" | "q", value: string) {
    // Router updates run in a transition: `prev` / `params` can still be the state before a
    // just-clicked tab, which would bring the old tab back. Build on the last params we set.
    const next = new URLSearchParams(latestParams.current);
    if (value && !(key === "status" && value === "all")) next.set(key, value);
    else next.delete(key);
    latestParams.current = next;
    setParams(next, { replace: true });
  }
  function pickTab(next: StatusTab) {
    setParam("status", next);
    setSelected(new Set());
  }
  function resetAll() {
    latestParams.current = new URLSearchParams();
    setParams(new URLSearchParams(), { replace: true });
    setGroupIds([]);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    const allOn = shown.length > 0 && shown.every((e) => selected.has(e.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const e of shown) {
        if (allOn) next.delete(e.id);
        else next.add(e.id);
      }
      return next;
    });
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
  }

  async function bulkStatus(isDraft: boolean) {
    const ids = selectedEvents.filter((e) => e.isDraft !== isDraft).map((e) => e.id);
    setBusy(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => apiPatch(`/api/calendars/${page.calendarId}/events/${id}`, { isDraft })),
      );
      await refresh();
      if (results.some((r) => r.status === "rejected")) toast.error(t("events.list.bulk.failed"));
      else {
        toast.success(
          t(isDraft ? "events.list.bulk.drafted" : "events.list.bulk.published", {
            count: selectedEvents.length,
          }),
        );
        setSelected(new Set());
      }
    } finally {
      setBusy(false);
    }
  }

  async function bulkDelete() {
    const ids = selectedEvents.map((e) => e.id);
    const results = await Promise.allSettled(
      ids.map((id) => apiDelete(`/api/calendars/${page.calendarId}/events/${id}`)),
    );
    await refresh();
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) toast.error(t("events.delete.manyFailed"));
    else toast.success(t("events.delete.manyDone", { count: ids.length }));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id, i) => {
        if (results[i].status === "fulfilled") next.delete(id);
      });
      return next;
    });
  }

  const sel = summarizeSelection(selectedEvents);
  const named = selectedEvents
    .slice(0, MAX_NAMED)
    .map((e) => `${e.name} (${formatShortDate(e.date.slice(0, 10), locale)})`);
  if (selectedEvents.length > MAX_NAMED)
    named.push(t("events.delete.more", { count: selectedEvents.length - MAX_NAMED }));

  // ——— Content by state ———
  let content: ReactNode;
  const kind = emptyKind(all.length, shown.length, filter);
  if (events.isLoading) {
    content = (
      <div className="ap-panel ap-panel--flush" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("events.list.loading")}
        </p>
        <div className="ap-list">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="ap-listrow">
              <Skeleton style={{ width: 24, height: 24 }} />
              <Skeleton style={{ width: "30%", height: 20 }} />
              <Skeleton className="ap-grow" style={{ height: 20 }} />
              <Skeleton style={{ width: 96, height: 24 }} />
            </div>
          ))}
        </div>
      </div>
    );
  } else if (events.isError && !events.data) {
    content = null;
  } else if (kind !== "none") {
    content = (
      <div className="ap-panel ap-panel--flush" style={{ padding: "var(--space-6)" }}>
        <ListEmpty
          kind={kind}
          query={query.trim()}
          canEdit={canEdit}
          routes={page.routes}
          modalState={modalState}
          onReset={resetAll}
          onTab={pickTab}
        />
      </div>
    );
  } else {
    content = (
      <div className="ap-panel ap-panel--flush">
        <EventsTable
          events={shown}
          caption={t("events.list.caption", { calendar: page.calendar?.name ?? "" })}
          hrefOf={(ev) => page.routes.edit(ev.id)}
          linkState={modalState}
          toneOf={toneOf}
          selected={canEdit ? selected : undefined}
          onToggle={canEdit ? toggle : undefined}
          onToggleAll={canEdit ? toggleAll : undefined}
        />
      </div>
    );
  }

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("events.list.title")}</h1>
          {page.calendar && events.data && (
            <p className="t-body">
              {t("events.list.subtitle", { calendar: page.calendar.name, count: all.length })}
            </p>
          )}
        </div>
        <div className="ap-actions">
          <nav className="ap-seg ap-hide-m" aria-label={t("calendar.viewSwitch")}>
            <Link to={page.base}>{t("calendar.views.month")}</Link>
            <Link to={`${page.base}?view=week`}>{t("calendar.views.week")}</Link>
            <Link to={page.routes.list} aria-current="page">
              {t("calendar.views.list")}
            </Link>
          </nav>
          {canEdit && (
            <SplitButton
              className="ap-hide-m"
              icon="plus"
              label={t("events.list.create")}
              onClick={() => navigate(page.routes.create(), { state: modalState })}
              menuLabel={t("calendar.createMore")}
              items={[
                {
                  key: "template",
                  icon: "layers" as const,
                  label: t("calendar.fromTemplate"),
                  onSelect: () => navigate(page.routes.pickTemplate(), { state: modalState }),
                },
                {
                  key: "import",
                  icon: "upload" as const,
                  label: t("calendar.import"),
                  to: `${page.base}/import`,
                },
              ]}
            />
          )}
        </div>
      </header>

      {page.isArchived && (
        <Banner tone="warning" icon="lock" title={t("shell.archivedReadOnly")} className="mb-4">
          {t("events.list.readOnly")}
        </Banner>
      )}

      <div className="ap-toolbar">
        <div className="ap-toolbar-search">
          <SearchInput
            value={query}
            onChange={(v) => setParam("q", v)}
            label={t("events.list.searchLabel")}
            placeholder={t("events.list.searchPlaceholder")}
          />
        </div>
        {groupList.length > 0 && (
          <FilterPillGroup
            label={t("events.list.groupFilter")}
            hideLabel
            items={groupList.map((g) => ({ id: g.id, label: g.name }))}
            selected={groupIds}
            onChange={(id) =>
              setGroupIds((prev) =>
                prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
              )
            }
          />
        )}
        {groupIds.length > 0 && (
          <Button variant="ghost" onClick={() => setGroupIds([])}>
            {t("events.list.resetFilter")}
          </Button>
        )}
      </div>

      <div className="ap-tabs" role="group" aria-label={t("events.list.statusFilter")}>
        {STATUS_TABS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={tab === key}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => pickTab(key)}
          >
            {t(`events.list.tabs.${key}`)}
            {events.data && <span className="ap-count">{counts[key]}</span>}
          </button>
        ))}
      </div>

      {events.isError && (
        <Banner
          tone="danger"
          title={t("events.list.error.title")}
          className="mb-4"
          action={
            <Button variant="secondary" icon="refresh" onClick={() => events.refetch()}>
              {t("events.list.error.retry")}
            </Button>
          }
        >
          {t("events.list.error.text")}
        </Banner>
      )}

      {content}

      {events.data && (
        <p className="t-sm t-muted" style={{ marginTop: "var(--space-3)" }} role="status">
          {t("events.list.footer", { shown: shown.length, count: all.length })}
        </p>
      )}

      {/* Always mounted, so the first selection is announced too (a new live region is not). */}
      <p className="ap-sr" role="status">
        {canEdit && selectedEvents.length > 0
          ? t("events.list.bulk.selected", { count: selectedEvents.length })
          : ""}
      </p>
      {canEdit && selectedEvents.length > 0 && (
        <div
          className="ap-bulkbar"
          role="region"
          aria-label={t("events.list.bulk.region")}
          style={{
            position: "sticky",
            bottom: "var(--space-4)",
            zIndex: 30,
            marginTop: "var(--space-4)",
          }}
        >
          <span className="t-label">
            {t("events.list.bulk.selected", { count: selectedEvents.length })}
          </span>
          <div className="ap-actions ap-grow">
            <Button
              variant="secondary"
              icon="check"
              disabled={busy || sel.drafts === 0}
              onClick={() => bulkStatus(false)}
            >
              {t("events.list.bulk.publish")}
            </Button>
            <Button
              variant="secondary"
              icon="edit"
              disabled={busy || sel.published === 0}
              onClick={() => bulkStatus(true)}
            >
              {t("events.list.bulk.draft")}
            </Button>
            <Button
              variant="danger"
              icon="trash"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              {t("events.list.bulk.delete")}
            </Button>
          </div>
          <Button variant="secondary" onClick={() => setSelected(new Set())}>
            {t("events.list.bulk.clear")}
          </Button>
        </div>
      )}

      {canEdit && (
        <LinkButton className="ap-fab" icon="plus" to={page.routes.create()} state={modalState}>
          {t("events.list.create")}
        </LinkButton>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        icon="trash"
        title={t("events.delete.manyTitle", { count: sel.count })}
        description={t("events.delete.manyText", { list: joinList(named, t("events.and")) })}
        consequence={
          sel.published === 0
            ? t("events.delete.manyConsequenceDrafts", { count: sel.count })
            : t("events.delete.manyConsequence", { count: sel.count })
        }
        confirmLabel={t("events.delete.manyConfirm", { count: sel.count })}
        onConfirm={bulkDelete}
      />
    </div>
  );
}

interface ListEmptyProps {
  kind: Exclude<ReturnType<typeof emptyKind>, "none">;
  query: string;
  canEdit: boolean;
  routes: ReturnType<typeof useEventPage>["routes"];
  /** Router state that opens the create dialog above the list. */
  modalState: ModalNavState;
  onReset: () => void;
  onTab: (tab: StatusTab) => void;
}

/** Empty states (design: EventsStates). */
function ListEmpty({ kind, query, canEdit, routes, modalState, onReset, onTab }: ListEmptyProps) {
  const { t } = useTranslation();
  const create = canEdit && (
    <LinkButton
      icon="plus"
      variant={kind === "noPublished" ? "secondary" : "primary"}
      to={routes.create()}
      state={modalState}
    >
      {t("events.list.create")}
    </LinkButton>
  );
  switch (kind) {
    case "noCalendarEvents":
      return (
        <EmptyState
          icon="calendar"
          title={t("events.list.empty.noEvents.title")}
          text={t("events.list.empty.noEvents.text")}
          actions={
            canEdit && (
              <>
                {create}
                <LinkButton variant="secondary" icon="upload" to={routes.import}>
                  {t("events.list.empty.noEvents.import")}
                </LinkButton>
              </>
            )
          }
        />
      );
    case "noSearchHits":
      return (
        <EmptyState
          icon="search"
          title={t("events.list.empty.noSearchHits.title", { query })}
          text={t("events.list.empty.noSearchHits.text")}
          actions={
            <Button variant="secondary" onClick={onReset}>
              {t("events.list.empty.noSearchHits.reset")}
            </Button>
          }
        />
      );
    case "noPublished":
      return (
        <EmptyState
          icon="globe"
          title={t("events.list.empty.noPublished.title")}
          text={t("events.list.empty.noPublished.text")}
          actions={
            <>
              <Button onClick={() => onTab("draft")}>
                {t("events.list.empty.noPublished.showDrafts")}
              </Button>
              {create}
            </>
          }
        />
      );
    case "noDrafts":
      return (
        <EmptyState
          icon="check-circle"
          title={t("events.list.empty.noDrafts.title")}
          text={t("events.list.empty.noDrafts.text")}
          actions={
            <>
              {create}
              <Button variant="secondary" onClick={() => onTab("all")}>
                {t("events.list.empty.noDrafts.showAll")}
              </Button>
            </>
          }
        />
      );
    default:
      return (
        <EmptyState
          icon="search"
          title={t("events.list.empty.noFilterHits.title")}
          text={t("events.list.empty.noFilterHits.text")}
          actions={
            <Button variant="secondary" onClick={onReset}>
              {t("events.list.empty.noFilterHits.reset")}
            </Button>
          }
        />
      );
  }
}
