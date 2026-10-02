import { useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventInput, EventClickArg, EventDropArg } from "@fullcalendar/core";
import deLocale from "@fullcalendar/core/locales/de";
import type { DateClickArg } from "@fullcalendar/interaction";
import { apiGet, apiPatch, apiPost, getHolidayEvents } from "@/lib/api";
import i18n from "@/lib/i18n";
import type { CalendarEvent, TargetGroup, Calendar } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Banner, FilterPillGroup, SearchInput, buttonClass } from "@/components/ui/shared";
import EventModal from "@/components/calendar/EventModal";
import { Plus, Upload } from "lucide-react";

export default function CalendarPage() {
  const { clubId, calendarId } = useParams<{ clubId: string; calendarId: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { t, i18n: i18nHook } = useTranslation();
  const fcLocale = i18nHook.resolvedLanguage === "de" ? deLocale : undefined;
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | undefined>();
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const selectedGroupsRef = useRef<string[]>([]);
  const searchQueryRef = useRef("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const calendarRef = useRef<InstanceType<typeof FullCalendar>>(null);

  const { data: targetGroups = [] } = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/target-groups`),
  });

  const { data: calendar, refetch: refetchCalendar } = useQuery<Calendar>({
    queryKey: ["calendar", clubId, calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  });

  const isArchived = !!calendar?.archivedAt;

  async function handleUnarchive() {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {});
    qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
    refetchCalendar();
  }

  function toggleGroup(id: string) {
    setSelectedGroups((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      selectedGroupsRef.current = next;
      setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0);
      return next;
    });
  }

  function clearFilter() {
    selectedGroupsRef.current = [];
    setSelectedGroups([]);
    setTimeout(() => calendarRef.current?.getApi().refetchEvents(), 0);
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value);
    searchQueryRef.current = value;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(
      () => calendarRef.current?.getApi().refetchEvents(),
      300,
    );
  }

  function clearSearch() {
    searchQueryRef.current = "";
    setSearchQuery("");
    calendarRef.current?.getApi().refetchEvents();
  }

  function openCreate(date?: string) {
    setEditingEvent(null);
    setSelectedDate(date);
    setModalOpen(true);
  }

  function openEdit(event: CalendarEvent) {
    setSelectedDate(undefined);
    setEditingEvent(event);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingEvent(null);
    setSelectedDate(undefined);
  }

  function fetchEvents(
    fetchInfo: { startStr: string; endStr: string },
    successCallback: (events: EventInput[]) => void,
    failureCallback: (err: Error) => void,
  ) {
    const tgParam =
      selectedGroupsRef.current.length > 0
        ? `&targetGroupIds=${selectedGroupsRef.current.join(",")}`
        : "";
    apiGet<CalendarEvent[]>(
      `/api/calendars/${calendarId}/events?from=${fetchInfo.startStr.slice(0, 10)}&to=${fetchInfo.endStr.slice(0, 10)}${tgParam}`,
    )
      .then((events) => {
        const q = searchQueryRef.current.trim().toLowerCase();
        const filtered = q ? events.filter((ev) => ev.name.toLowerCase().includes(q)) : events;
        successCallback(
          filtered.map((ev) => {
            const startDateStr = ev.date.slice(0, 10);
            const endDateStr = ev.dateEnd?.slice(0, 10) ?? startDateStr;
            const iconPrefix = ev.properties
              .map((p) => p.property.icon)
              .filter(Boolean)
              .join("");
            const title = [iconPrefix, ev.name].filter(Boolean).join(" ");

            if (ev.isAllDay) {
              const endExclusive = new Date(endDateStr);
              endExclusive.setDate(endExclusive.getDate() + 1);
              return {
                id: String(ev.id),
                title,
                start: startDateStr,
                end: endExclusive.toISOString().slice(0, 10),
                allDay: true,
                backgroundColor: ev.isDraft ? "#94a3b8" : "#2563eb",
                borderColor: ev.isDraft ? "#94a3b8" : "#1d4ed8",
                textColor: "#fff",
                extendedProps: { event: ev },
              };
            }

            return {
              id: String(ev.id),
              title,
              start: `${startDateStr}T${ev.timeBegin}`,
              end: `${endDateStr}T${ev.timeEnd}`,
              backgroundColor: ev.isDraft ? "#94a3b8" : "#2563eb",
              borderColor: ev.isDraft ? "#94a3b8" : "#1d4ed8",
              textColor: "#fff",
              extendedProps: { event: ev },
            };
          }),
        );
      })
      .catch(failureCallback);
  }

  const fetchHolidayEvents = useCallback(
    async (
      info: { startStr: string; endStr: string },
      successCallback: (events: EventInput[]) => void,
      failureCallback: (error: Error) => void,
    ) => {
      try {
        const from = info.startStr.slice(0, 10);
        const to = info.endStr.slice(0, 10);
        const holidays = await getHolidayEvents(calendarId!, from, to);
        successCallback(
          holidays.map((h) => ({
            id: `holiday-${h.id}`,
            title: h.name,
            start: h.date,
            end: h.dateEnd
              ? new Date(new Date(h.dateEnd + "T00:00:00").getTime() + 86_400_000)
                  .toISOString()
                  .slice(0, 10)
              : undefined,
            allDay: true,
            editable: false,
            classNames: ["fc-holiday-event"],
            extendedProps: { isHoliday: true },
          })),
        );
      } catch (e) {
        failureCallback(e instanceof Error ? e : new Error("Failed to load holidays"));
      }
    },
    [calendarId],
  );

  function handleDateClick(info: DateClickArg) {
    openCreate(info.dateStr);
  }

  function handleEventClick(info: EventClickArg) {
    if (info.event.extendedProps?.isHoliday) return;
    const ev = info.event.extendedProps.event as CalendarEvent;
    openEdit(ev);
  }

  async function handleEventDrop(info: EventDropArg) {
    if (info.event.extendedProps?.isHoliday) {
      info.revert();
      return;
    }
    const ev = info.event.extendedProps.event as CalendarEvent;
    const newStartStr = info.event.startStr.slice(0, 10);

    let newDateEnd: string | null = null;
    if (ev.dateEnd) {
      const oldStart = new Date(ev.date.slice(0, 10));
      const oldEnd = new Date(ev.dateEnd.slice(0, 10));
      const diffDays = Math.round((oldEnd.getTime() - oldStart.getTime()) / 86400000);
      const newEnd = new Date(newStartStr);
      newEnd.setDate(newEnd.getDate() + diffDays);
      newDateEnd = newEnd.toISOString().slice(0, 10);
    }

    try {
      await apiPatch(`/api/calendars/${calendarId}/events/${ev.id}`, {
        date: newStartStr,
        ...(newDateEnd !== null ? { dateEnd: newDateEnd } : {}),
      });
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
    } catch {
      info.revert();
    }
  }

  return (
    <div className="p-6">
      {isArchived && (
        <Banner
          tone="warning"
          icon="lock"
          title={t("shell.archivedReadOnly")}
          className="mb-6"
          action={
            <button type="button" onClick={handleUnarchive} className={buttonClass("secondary")}>
              {t("calendar.unarchive")}
            </button>
          }
        >
          {t("calendar.archivedNotice")}
        </Banner>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-slate-900">{t("calendar.title")}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={searchQuery}
            onChange={(val) => (val === "" ? clearSearch() : handleSearchChange(val))}
            placeholder={t("calendar.searchEvents")}
          />
          <Link to={`/clubs/${clubId}/calendars/${calendarId}/import`}>
            <Button size="sm" variant="outline">
              <Upload className="mr-1 h-3.5 w-3.5" />
              {t("calendar.importIcs")}
            </Button>
          </Link>
          <Button size="sm" onClick={() => openCreate()}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("calendar.newEvent")}
          </Button>
        </div>
      </div>

      {targetGroups.length > 1 && (
        <FilterPillGroup
          label={t("calendar.filter")}
          clearAllLabel={t("calendar.allGroups")}
          items={targetGroups.map((tg) => ({ id: tg.id, label: tg.name }))}
          selected={selectedGroups}
          onChange={toggleGroup}
          onClearAll={clearFilter}
          className="mb-4"
        />
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          eventSources={[
            { events: fetchEvents },
            {
              events: fetchHolidayEvents,
              color: "#f97316",
              textColor: "#ffffff",
            },
          ]}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          editable={true}
          eventDrop={handleEventDrop}
          selectable={false}
          firstDay={user?.firstDayOfWeek ?? 1}
          displayEventTime={true}
          eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
          headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth" }}
          height="auto"
          eventContent={renderEvent}
          locale={fcLocale}
        />
      </div>

      <p className="mt-2 text-xs text-slate-400">{t("calendar.clickToEdit")}</p>

      <EventModal
        calendarId={calendarId!}
        open={modalOpen}
        onClose={closeModal}
        defaultDate={selectedDate}
        event={editingEvent}
      />
    </div>
  );
}

function renderEvent(info: {
  event: {
    title: string;
    start: Date | null;
    extendedProps: { event?: CalendarEvent; isHoliday?: boolean };
  };
  timeText: string;
}) {
  const { timeText, event } = info;

  if (event.extendedProps.isHoliday) {
    return <div className="truncate px-1 text-xs font-medium">{event.title}</div>;
  }

  const ev = event.extendedProps.event;
  return (
    <div className="truncate px-1 text-xs">
      <span className="opacity-80">{timeText} </span>
      <span className="font-medium">{event.title}</span>
      {ev?.isDraft && <span className="ml-1 opacity-60">{i18n.t("calendar.draft")}</span>}
    </div>
  );
}
