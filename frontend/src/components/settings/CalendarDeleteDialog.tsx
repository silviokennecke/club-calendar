import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/shared";
import { apiGet } from "@/lib/api";
import type { Calendar } from "@/lib/types";

interface CalendarDeleteDialogProps {
  clubId: string;
  calendar: Calendar;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * "Kalender löschen?" with the consequences (design: Club.dc.html deleteCalendar / deleteArchived,
 * Dialogs.dc.html "Kalender löschen"). An active calendar names its number of events ("Löscht den
 * Kalender mit allen 6 Terminen …") from the calendar's `eventCount`, refreshed by one single GET when
 * the dialog opens; an archived calendar uses the fixed "no restore" wording. Feeds are club-level: those
 * that exist only for this calendar (`exclusiveFeedCount`) are deleted with it, the others
 * (`feedCount` minus exclusive) only lose it.
 */
export function CalendarDeleteDialog({
  clubId,
  calendar,
  onClose,
  onConfirm,
}: CalendarDeleteDialogProps) {
  const { t } = useTranslation();
  const archived = !!calendar.archivedAt;
  const fresh = useQuery({
    queryKey: ["calendarScope", calendar.id],
    enabled: !archived,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendar.id}`),
  });
  const events = fresh.data?.eventCount ?? calendar.eventCount;
  const exclusive = (fresh.data ?? calendar).exclusiveFeedCount;
  const total = (fresh.data ?? calendar).feedCount;
  const losing =
    total === undefined || exclusive === undefined ? 0 : Math.max(0, total - exclusive);
  const scope = {
    isError: fresh.isError && events === undefined,
    data: events === undefined ? undefined : { events },
  };

  let consequence: string;
  if (archived) consequence = t("settings.delete.archived.consequence", { name: calendar.name });
  else if (scope.isError) consequence = t("settings.delete.consequence.unknown");
  else if (!scope.data) consequence = t("settings.delete.consequence.loading");
  else if (scope.data.events === 0) consequence = t("settings.delete.consequence.noEvents");
  else consequence = t("settings.delete.consequence.events", { count: scope.data.events });

  const feedNotes = [
    exclusive ? t("settings.delete.feedsDeleted", { count: exclusive }) : null,
    losing > 0 ? t("settings.delete.feedsLost", { count: losing }) : null,
  ].filter(Boolean);
  if (feedNotes.length > 0) consequence = `${consequence} ${feedNotes.join(" ")}`;

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
