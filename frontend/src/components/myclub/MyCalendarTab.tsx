import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/shared";

/** Tab "Kalender" of Mein Verein: the events of the personal subscription. */
export function MyCalendarTab({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  return (
    <div data-club-id={clubId}>
      <EmptyState
        icon="calendar"
        title={t("myClub.calendar.emptyTitle")}
        text={t("myClub.calendar.emptyText")}
      />
    </div>
  );
}
