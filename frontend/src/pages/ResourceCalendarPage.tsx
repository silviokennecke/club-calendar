import { useId, useMemo, useState } from "react";
import { Link, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiErrorStatus, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isStaff } from "@/lib/club/permissions";
import { resourceItems } from "@/lib/resourceCalendar";
import {
  addDays,
  formatMonthTitle,
  formatWeekRange,
  isoWeek,
  parseAnchor,
  parseView,
  startOfWeek,
  stepAnchor,
  todayIn,
  visibleRange,
  weekDays,
  yearMonthOf,
  type WeekStart,
} from "@/lib/calendar";
import type { Club, Resource, ResourceCalendarItem } from "@/lib/types";
import { useIsMobile } from "@/lib/useMediaQuery";
import { usePageTitle } from "@/lib/usePageTitle";
import type { ShellData } from "@/components/layout/shellTypes";
import { Banner, Button, EmptyState, LinkButton, Skeleton } from "@/components/ui/shared";
import { CalendarLegend } from "@/components/calendar/CalendarLegend";
import { MonthNav } from "@/components/calendar/MonthNav";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";
import { useLocale } from "@/components/calendar/useLocale";

type MemberResource = Pick<Resource, "id" | "name">;

/**
 * Calendar of one resource: month and week view of all events at its location over all calendars of
 * the club. Presentation only. Plain members get busy-only items ("Belegt").
 */
export default function ResourceCalendarPage() {
  const { clubId = "", resourceId = "" } = useParams<{ clubId: string; resourceId: string }>();
  const shell = useOutletContext<ShellData | undefined>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const locale = useLocale();
  const isMobile = useIsMobile();
  const titleId = `res-cal-${useId().replace(/:/g, "")}`;
  const [params, setParams] = useSearchParams();
  const [panelOpen, setPanelOpen] = useState(false);

  const clubsQuery = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
    enabled: !shell,
  });
  const club = (shell?.clubs ?? clubsQuery.data)?.find((c) => c.id === clubId);
  const staff = isStaff(club?.role);

  const list = useQuery<MemberResource[]>({
    queryKey: ["resources", clubId],
    queryFn: () => apiGet<MemberResource[]>(`/api/clubs/${clubId}/resources`),
    enabled: !!clubId,
  });
  const resource = list.data?.find((r) => r.id === resourceId);
  usePageTitle(resource ? t("resourceCalendar.pageTitle", { name: resource.name }) : null);

  const today = todayIn(club?.timezone);
  const weekStart: WeekStart = user?.firstDayOfWeek === 0 ? 0 : 1;
  const view = isMobile ? "month" : parseView(params.get("view"));
  const anchor = parseAnchor(params.get("date"), today);
  const [from, to] = visibleRange(view, anchor, weekStart);

  const events = useQuery<ResourceCalendarItem[]>({
    queryKey: ["resourceEvents", clubId, resourceId, from, to],
    queryFn: () =>
      apiGet<ResourceCalendarItem[]>(
        `/api/clubs/${clubId}/resources/${resourceId}/events?from=${from}&to=${to}`,
      ),
    enabled: !!clubId && !!resourceId,
    placeholderData: keepPreviousData,
    retry: (count, error) => apiErrorStatus(error) !== 404 && count < 2,
  });

  const items = useMemo(
    () => resourceItems(events.data ?? [], t("resourceCalendar.busy")),
    [events.data, t],
  );

  function setAnchor(date: string, replace = true) {
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
  }
  function navigate(direction: -1 | 1) {
    setPanelOpen(false);
    setAnchor(stepAnchor(view, anchor, direction), false);
  }
  function hrefFor(v: "month" | "week") {
    const next = new URLSearchParams(params);
    next.set("date", anchor);
    if (v === "week") next.set("view", "week");
    else next.delete("view");
    return `?${next.toString()}`;
  }

  const back = `/clubs/${clubId}/settings/resources`;
  const notFound =
    apiErrorStatus(events.error) === 404 || (list.isSuccess && !!list.data && !resource);

  if (notFound) {
    return (
      <div className="ap-wrap">
        <EmptyState
          icon="layers"
          title={t("resourceCalendar.notFound.title")}
          text={t("resourceCalendar.notFound.text")}
          actions={
            <LinkButton to={back} icon="chevron-left">
              {t("resourceCalendar.back")}
            </LinkButton>
          }
        />
      </div>
    );
  }

  const title =
    view === "week"
      ? t("calendar.weekTitle", {
          week: isoWeek(addDays(startOfWeek(anchor, weekStart), 3)).week,
          range: formatWeekRange(startOfWeek(anchor, weekStart), locale),
        })
      : formatMonthTitle(yearMonthOf(anchor), locale);
  const week = view === "week";

  let content;
  if (events.isPending) {
    content = (
      <div aria-busy="true">
        <p className="ap-sr" role="status">
          {t("resourceCalendar.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 420 }} />
      </div>
    );
  } else if (events.isError && !events.data) {
    content = (
      <Banner
        tone="danger"
        title={t("resourceCalendar.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void events.refetch()}>
            {t("resourceCalendar.loadError.retry")}
          </Button>
        }
      >
        {t("resourceCalendar.loadError.text")}
      </Banner>
    );
  } else if (week) {
    content = (
      <>
        <WeekView
          days={weekDays(anchor, weekStart)}
          items={items}
          today={today}
          onOpenItem={() => undefined}
        />
        <CalendarLegend showHoliday={false} showDraft={staff} />
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
        onOpenItem={() => undefined}
        showHolidayLegend={false}
        publicView={!staff}
      />
    );
  }

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <p className="t-cap t-muted">
            <Link to={back}>{t("resourceCalendar.back")}</Link>
          </p>
          <h1 className="t-h1">{resource?.name ?? t("resourceCalendar.title")}</h1>
        </div>
      </header>
      <div className="ap-pagehead">
        <MonthNav
          as="h2"
          title={title}
          titleId={titleId}
          unit={view}
          onPrev={() => navigate(-1)}
          onNext={() => navigate(1)}
          onToday={() => {
            setPanelOpen(false);
            setAnchor(today, anchor === today);
          }}
        />
        <nav className="ap-seg ap-hide-m" aria-label={t("calendar.viewSwitch")}>
          <Link to={hrefFor("month")} aria-current={!week ? "page" : undefined}>
            {t("calendar.views.month")}
          </Link>
          <Link to={hrefFor("week")} aria-current={week ? "page" : undefined}>
            {t("calendar.views.week")}
          </Link>
        </nav>
      </div>
      {content}
    </div>
  );
}
