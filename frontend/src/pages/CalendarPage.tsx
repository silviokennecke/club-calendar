import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useIsMobile } from "@/lib/useMediaQuery";
import type { Calendar, CalendarEvent, TargetGroup } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import {
  addDays,
  formatMonthTitle,
  formatNumericDate,
  formatWeekRange,
  isoWeek,
  matchesSearch,
  parseAnchor,
  parseView,
  readCalendarView,
  shiftEventDates,
  startOfWeek,
  stepAnchor,
  storeCalendarView,
  todayIn,
  weekDays,
  yearMonthOf,
  type CalItem,
  type IsoDate,
  type WeekStart,
} from "@/lib/calendar";
import type { ShellData } from "@/components/layout/shellTypes";
import { Banner, Button, EmptyState, LinkButton, toast } from "@/components/ui/shared";
import { CalendarToolbar } from "@/components/calendar/CalendarToolbar";
import { FilterBar } from "@/components/calendar/FilterBar";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { CalendarLegend } from "@/components/calendar/CalendarLegend";
import { CalendarSkeleton } from "@/components/calendar/CalendarSkeleton";
import { playPeriodTransition, useSwipeNav } from "@/components/calendar/useSwipeNav";
import { useCalendarData } from "@/components/calendar/useCalendarData";
import { useLocale } from "@/components/calendar/useLocale";
import { audienceTone } from "@/components/calendar/eventDisplay";
import type { EventItemTag } from "@/components/calendar/EventItem";
import { useEventPage } from "@/components/events/useEventPage";
import { eventRoutes } from "@/components/events/routes";
import { openModalState } from "@/lib/modalRoutes";
import { preloadEventModals } from "./lazy";

/**
 * Calendar (design: Calendar, CalendarWeek, CalendarArchived, CalendarStates, CalendarMobile).
 * View and date live in the URL (?view=week&date=2026-10-08) so back/forward and links work.
 */
export default function CalendarPage() {
  const { clubId, calendarId } = useParams<{ clubId: string; calendarId: string }>();
  const shell = useOutletContext<ShellData | undefined>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t } = useTranslation();
  const locale = useLocale();
  const isMobile = useIsMobile();
  const titleId = `cal-title-${useId().replace(/:/g, "")}`;
  const [params, setParams] = useSearchParams();
  const routerNavigate = useNavigate();
  const location = useLocation();

  const [panelOpen, setPanelOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [restored, setRestored] = useState(false);
  const [unarchiving, setUnarchiving] = useState(false);

  const { data: calendar, refetch: refetchCalendar } = useQuery<Calendar>({
    queryKey: ["calendar", clubId, calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  });
  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", clubId],
    queryFn: () => apiGet(`/api/clubs/${clubId}/target-groups`),
  });

  const club = shell?.clubs.find((c) => c.id === clubId);
  const today = todayIn(calendar?.timezone || club?.timezone);
  const weekStart: WeekStart = user?.firstDayOfWeek === 0 ? 0 : 1;
  // Opened without view and date (sidebar link): return to the month / week shown before in this
  // session. Explicit URL parameters always win. Used while rendering, so no wrong month flashes;
  // the effect below writes it into the address (replace, no history entry).
  const remembered = useMemo(
    () => (params.has("date") || params.has("view") ? null : readCalendarView(calendarId!)),
    [params, calendarId],
  );
  const view = isMobile ? "month" : parseView(remembered ? remembered.view : params.get("view"));
  const anchor = parseAnchor(remembered ? remembered.date : params.get("date"), today);
  const isArchived = !!calendar?.archivedAt;
  // Club role (shell clubs, or the club list when rendered without the shell).
  const { roleCanEdit, isAdmin } = useEventPage();
  const canEdit = !!calendar && !isArchived && roleCanEdit;
  const filtering = search.trim() !== "" || selectedGroups.length > 0;

  const data = useCalendarData({
    clubId: clubId!,
    calendarId: calendarId!,
    view,
    anchor,
    weekStart,
    targetGroupIds: selectedGroups,
    checkEmpty: !filtering,
  });

  const items = useMemo<CalItem[]>(() => {
    const events = data.eventItems.filter((i) => matchesSearch(i, search));
    // Holidays only without a search or filter (design: they would not match anyway).
    return filtering ? events : [...data.holidayItems, ...events];
  }, [data.eventItems, data.holidayItems, search, filtering]);
  const visibleEvents = items.filter((i) => i.kind === "event").length;

  /**
   * Focus moves within the grid replace the history entry; previous / next / today push one,
   * so the browser's back button returns to the month or week shown before.
   */
  // The router commits URL changes in a transition, so `anchor` can lag behind fast repeated
  // clicks on previous / next; keep the last requested date.
  const latestAnchor = useRef(anchor);
  // The event dialogs open from here: load their chunks in the background.
  useEffect(preloadEventModals, []);
  useEffect(() => {
    latestAnchor.current = anchor;
  }, [anchor]);

  useEffect(() => {
    if (!remembered) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("date", remembered.date);
        if (remembered.view === "week") next.set("view", "week");
        return next;
      },
      { replace: true },
    );
  }, [remembered, setParams]);

  // Remember what the address shows (only explicit dates: "today" by default needs no memory).
  const hasDateParam = params.has("date");
  useEffect(() => {
    if (calendarId && hasDateParam) storeCalendarView(calendarId, { view, date: anchor });
  }, [calendarId, hasDateParam, view, anchor]);

  const setAnchor = useCallback(
    (date: IsoDate, { replace = true }: { replace?: boolean } = {}) => {
      latestAnchor.current = date;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("date", date);
          if (view === "week") next.set("view", "week");
          else next.delete("view");
          return next;
        },
        { replace },
      );
    },
    [setParams, view],
  );

  const pendingDirection = useRef<-1 | 1 | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useSwipeNav<HTMLDivElement>({
    onPrev: () => navigate(-1),
    onNext: () => navigate(1),
  });
  const setBoard = useCallback(
    (node: HTMLDivElement | null) => {
      boardRef.current = node;
      swipeRef(node);
    },
    [swipeRef],
  );
  const periodKey = view === "week" ? anchor : anchor.slice(0, 7);
  useEffect(() => {
    const dir = pendingDirection.current;
    pendingDirection.current = null;
    if (dir) playPeriodTransition(boardRef.current, dir);
  }, [periodKey, view]);

  function navigate(direction: -1 | 1) {
    pendingDirection.current = direction;
    setPanelOpen(false);
    setAnchor(stepAnchor(view, latestAnchor.current, direction), { replace: false });
  }

  function hrefFor(v: "month" | "week") {
    const next = new URLSearchParams(params);
    next.set("date", anchor);
    if (v === "week") next.set("view", "week");
    else next.delete("view");
    return `?${next.toString()}`;
  }

  const title =
    view === "week"
      ? t("calendar.weekTitle", {
          // Mid-week day: with Sunday as first day, the Sunday belongs to the previous ISO week.
          week: isoWeek(addDays(startOfWeek(anchor, weekStart), 3)).week,
          range: formatWeekRange(startOfWeek(anchor, weekStart), locale),
        })
      : formatMonthTitle(yearMonthOf(anchor), locale);

  // ——— Events (dialogs above this view and date: router state `background`) ———
  const base = `/clubs/${clubId}/calendars/${calendarId}`;
  const routes = eventRoutes(base);
  const navState = openModalState(location);

  /** "Termin anlegen": choice blank / template / import (design: EventNew). */
  function openCreate(date?: string) {
    routerNavigate(routes.create(date), { state: navState });
  }

  function openItem(item: CalItem) {
    if (item.kind !== "event") return;
    routerNavigate(routes.edit(item.id), { state: navState });
  }

  async function patchDates(ev: CalendarEvent, dates: { date: string; dateEnd: string | null }) {
    await apiPatch(`/api/calendars/${calendarId}/events/${ev.id}`, {
      date: dates.date,
      ...(ev.dateEnd || dates.dateEnd ? { dateEnd: dates.dateEnd } : {}),
    });
    await qc.invalidateQueries({ queryKey: ["events", calendarId] });
  }

  async function moveItem(item: CalItem, date: IsoDate) {
    const ev = item.source as CalendarEvent;
    const before = { date: ev.date.slice(0, 10), dateEnd: ev.dateEnd?.slice(0, 10) ?? null };
    try {
      await patchDates(ev, shiftEventDates(ev, date));
      toast.success(t("calendar.move.success", { date: formatNumericDate(date, locale) }), {
        action: {
          label: t("calendar.move.undo"),
          onClick: () => {
            patchDates(ev, before)
              .then(() => toast.success(t("calendar.move.undone")))
              .catch(() => toast.error(t("calendar.move.failed")));
          },
        },
      });
    } catch {
      toast.error(t("calendar.move.failed"));
    }
  }

  async function handleUnarchive() {
    setUnarchiving(true);
    try {
      await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {});
      setRestored(true);
      void qc.invalidateQueries({ queryKey: ["calendars", clubId] });
      await refetchCalendar();
    } catch {
      toast.error(t("calendar.archived.failed"));
    } finally {
      setUnarchiving(false);
    }
  }

  function resetFilters() {
    setSearch("");
    setSelectedGroups([]);
  }

  const placeOf = (item: CalItem) => {
    const loc = (item.source as CalendarEvent).location;
    return loc ? loc.name || formatAddress(loc) : null;
  };
  const tagsOf = (item: CalItem): EventItemTag[] =>
    ((item.source as CalendarEvent).targetGroups ?? []).map(({ targetGroup }) => ({
      id: targetGroup.id,
      label: targetGroup.name,
      tone: audienceTone(targetGroups.findIndex((g) => g.id === targetGroup.id)),
    }));

  // ——— Content by state ———
  let content: ReactNode;
  if (data.isLoading) {
    content = <CalendarSkeleton />;
  } else if (data.calendarEmpty && !filtering) {
    content = (
      <EmptyState
        icon="calendar"
        title={t("calendar.empty.title")}
        text={isArchived ? t("calendar.empty.archivedText") : t("calendar.empty.text")}
        actions={
          canEdit && (
            <>
              <Button icon="plus" onClick={() => openCreate()}>
                {t("calendar.create")}
              </Button>
              <LinkButton
                variant="secondary"
                icon="upload"
                to={`/clubs/${clubId}/calendars/${calendarId}/import`}
              >
                {t("calendar.import")}
              </LinkButton>
            </>
          )
        }
      />
    );
  } else if (search.trim() && visibleEvents === 0 && !data.isError) {
    content = (
      <EmptyState
        icon="search"
        title={t("calendar.noResults.title", { query: search.trim() })}
        text={t("calendar.noResults.text")}
        actions={
          <Button variant="secondary" onClick={() => setSearch("")}>
            {t("calendar.noResults.reset")}
          </Button>
        }
      />
    );
  } else if (view === "week") {
    content = (
      <>
        <WeekView
          days={weekDays(anchor, weekStart)}
          items={items}
          today={today}
          onOpenItem={openItem}
        />
        <CalendarLegend />
      </>
    );
  } else {
    content = (
      <MonthView
        month={yearMonthOf(anchor)}
        weekStart={weekStart}
        items={items}
        today={today}
        activeDate={anchor}
        selectedDate={anchor}
        panelOpen={panelOpen}
        compact={isMobile}
        labelledBy={titleId}
        onMoveFocus={(date) => setAnchor(date)}
        onSelectDay={(date) => {
          setAnchor(date);
          setPanelOpen(true);
        }}
        onClosePanel={() => setPanelOpen(false)}
        onOpenItem={openItem}
        onCreateOnDay={canEdit ? openCreate : undefined}
        onDropItem={canEdit && !isMobile ? moveItem : undefined}
        placeOf={placeOf}
        tagsOf={tagsOf}
      />
    );
  }

  return (
    <div className="ap-wrap">
      {(isArchived || restored) && (
        <div className="ap-stack" style={{ marginBottom: "var(--space-6)" }}>
          {isArchived ? (
            <Banner
              tone="warning"
              icon="lock"
              title={t("shell.archivedReadOnly")}
              action={
                isAdmin && (
                  <Button variant="secondary" onClick={handleUnarchive} loading={unarchiving}>
                    {t("calendar.archived.unarchive")}
                  </Button>
                )
              }
            >
              {t("calendar.archived.text")}
            </Banner>
          ) : (
            <Banner tone="success">{t("calendar.archived.restored")}</Banner>
          )}
        </div>
      )}

      <CalendarToolbar
        view={view}
        title={title}
        titleId={titleId}
        monthHref={hrefFor("month")}
        weekHref={hrefFor("week")}
        listHref={`${base}/events`}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        onToday={() => {
          setPanelOpen(false);
          setAnchor(today, { replace: latestAnchor.current === today });
        }}
        archived={isArchived}
        onCreate={canEdit ? () => openCreate() : undefined}
        onCreateFromTemplate={
          canEdit ? () => routerNavigate(routes.pickTemplate(), { state: navState }) : undefined
        }
        importHref={canEdit ? `${base}/import` : undefined}
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        groups={targetGroups.map((g) => ({ id: g.id, label: g.name }))}
        selectedGroups={selectedGroups}
        onToggleGroup={(id) =>
          setSelectedGroups((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
          )
        }
        onReset={resetFilters}
        actions={
          isArchived && (
            <LinkButton variant="secondary" icon="download" to={routes.export}>
              {t("events.list.export")}
            </LinkButton>
          )
        }
      />

      {data.isError && (
        <Banner
          tone="danger"
          title={t("calendar.error.title")}
          className="mb-4"
          action={
            <Button variant="secondary" icon="refresh" onClick={data.refetch}>
              {t("calendar.error.retry")}
            </Button>
          }
        >
          {t("calendar.error.text")}
        </Banner>
      )}

      {(!data.isError || data.hasData) && <div ref={setBoard}>{content}</div>}

      {canEdit && isMobile && (
        <Button className="ap-fab" icon="plus" onClick={() => openCreate(anchor)}>
          {t("calendar.create")}
        </Button>
      )}
    </div>
  );
}
