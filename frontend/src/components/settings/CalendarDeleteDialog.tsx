import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/shared";
import { apiGet } from "@/lib/api";
import type { Calendar, CalendarEvent, CalendarFeed, EventTemplate } from "@/lib/types";

interface CalendarDeleteDialogProps {
  calendar: Calendar;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * "Kalender löschen?" with the consequences (design: Club.dc.html deleteCalendar). Counts the events,
 * templates and feeds when the dialog opens, because the backend offers no counters.
 */
export function CalendarDeleteDialog({ calendar, onClose, onConfirm }: CalendarDeleteDialogProps) {
  const { t } = useTranslation();
  const scope = useQuery({
    queryKey: ["calendarScope", calendar.id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [events, templates, feeds] = await Promise.all([
        apiGet<CalendarEvent[]>(`/api/calendars/${calendar.id}/events`),
        apiGet<EventTemplate[]>(`/api/calendars/${calendar.id}/templates`),
        apiGet<CalendarFeed[]>(`/api/calendars/${calendar.id}/feeds`),
      ]);
      return { events: events.length, templates: templates.length, feeds: feeds.length };
    },
  });

  let consequence: string;
  if (scope.isError) consequence = t("settings.delete.consequence.unknown");
  else if (!scope.data) consequence = t("settings.delete.consequence.loading");
  else
    consequence = t("settings.delete.consequence.counts", {
      name: calendar.name,
      events: scope.data.events,
      templates: scope.data.templates,
      feeds: scope.data.feeds,
    });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      icon="trash"
      title={t("settings.delete.confirmTitle", { name: calendar.name })}
      description={t("settings.delete.confirmText")}
      consequence={consequence}
      confirmLabel={t("settings.delete.confirm")}
      onConfirm={onConfirm}
    />
  );
}
