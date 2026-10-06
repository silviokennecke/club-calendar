import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/shared";
import { apiGet } from "@/lib/api";
import type { Calendar, CalendarEvent } from "@/lib/types";

interface CalendarDeleteDialogProps {
  calendar: Calendar;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * "Kalender löschen?" with the consequences (design: Club.dc.html deleteCalendar / deleteArchived,
 * Dialogs.dc.html "Kalender löschen"). An active calendar names its number of events ("Löscht den
 * Kalender mit allen 6 Terminen und seinen Feeds …"), counted when the dialog opens because the backend
 * offers no counters; an archived calendar uses the fixed "no restore" wording.
 */
export function CalendarDeleteDialog({ calendar, onClose, onConfirm }: CalendarDeleteDialogProps) {
  const { t } = useTranslation();
  const archived = !!calendar.archivedAt;
  const scope = useQuery({
    queryKey: ["calendarScope", calendar.id],
    enabled: !archived,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const events = await apiGet<CalendarEvent[]>(`/api/calendars/${calendar.id}/events`);
      return { events: events.length };
    },
  });

  let consequence: string;
  if (archived) consequence = t("settings.delete.archived.consequence", { name: calendar.name });
  else if (scope.isError) consequence = t("settings.delete.consequence.unknown");
  else if (!scope.data) consequence = t("settings.delete.consequence.loading");
  else if (scope.data.events === 0) consequence = t("settings.delete.consequence.noEvents");
  else consequence = t("settings.delete.consequence.events", { count: scope.data.events });

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      icon="trash"
      title={t(archived ? "settings.delete.archived.title" : "settings.delete.confirmTitle", {
        name: calendar.name,
      })}
      description={t(archived ? "settings.delete.archived.text" : "settings.delete.confirmText")}
      consequence={consequence}
      confirmLabel={t("settings.delete.confirm")}
      onConfirm={onConfirm}
    />
  );
}
