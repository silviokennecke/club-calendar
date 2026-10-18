import { useTranslation } from "react-i18next";
import { Tag } from "@/components/ui/shared";
import type { Calendar, CalendarFeed } from "@/lib/types";

/** Names of the calendars a feed publishes (archived ones are marked: they add no events). */
export function CalendarTags({
  feed,
  calendars,
}: {
  feed: Pick<CalendarFeed, "name" | "calendarIds">;
  calendars: Calendar[];
}) {
  const { t } = useTranslation();
  const selected = (feed.calendarIds ?? [])
    .map((id) => calendars.find((c) => c.id === id))
    .filter((c): c is Calendar => !!c);
  if (selected.length === 0) return null;
  return (
    <div className="ap-chips" role="group" aria-label={t("feeds.calendarsOf", { name: feed.name })}>
      {selected.map((c) => (
        <Tag key={c.id} tone="neutral">
          {c.archivedAt ? t("feeds.form.calendarArchived", { name: c.name }) : c.name}
        </Tag>
      ))}
    </div>
  );
}
