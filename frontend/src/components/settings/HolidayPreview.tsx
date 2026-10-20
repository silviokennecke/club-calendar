import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Disclosure, Skeleton } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";
import { addDays, todayIn } from "@/lib/calendar";
import { formatEventDates } from "@/lib/events";
import { getHolidayEvents } from "@/lib/api";

interface HolidayPreviewProps {
  calendarId: string;
  holidayCalendarId: string;
  holidayCalendarName: string;
  timeZone: string | null;
}

/** The next twelve months of one holiday calendar, loaded when the disclosure is opened. */
export function HolidayPreview({
  calendarId,
  holidayCalendarId,
  holidayCalendarName,
  timeZone,
}: HolidayPreviewProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const from = todayIn(timeZone);
  const to = addDays(from, 365);

  const events = useQuery({
    queryKey: ["holidayEvents", calendarId, from, to],
    enabled: open,
    queryFn: () => getHolidayEvents(calendarId, from, to),
  });
  const mine = (events.data ?? []).filter((h) => h.holidayCalendarId === holidayCalendarId);

  return (
    <Disclosure
      title={
        <span aria-label={t("settings.holidays.previewLabel", { name: holidayCalendarName })}>
          {t("settings.holidays.preview")}
        </span>
      }
      onToggle={setOpen}
    >
      <div className="ap-stack ap-stack--sm" style={{ paddingBottom: "var(--space-2)" }}>
        {events.isLoading && (
          <div aria-busy="true">
            <p className="ap-sr" role="status">
              {t("settings.holidays.previewLoading")}
            </p>
            <Skeleton style={{ display: "block", height: 24, width: "60%" }} />
          </div>
        )}
        {events.isError && (
          <p className="t-sm" role="alert">
            {t("settings.holidays.previewError")}
          </p>
        )}
        {events.data && mine.length === 0 && (
          <p className="t-sm t-muted">{t("settings.holidays.previewEmpty")}</p>
        )}
        {mine.length > 0 && (
          <ul className="t-sm ap-stack ap-stack--sm" style={{ listStyle: "none", padding: 0 }}>
            {mine.map((h) => (
              <li key={h.id}>
                <b style={{ display: "inline" }}>{formatEventDates(h, locale)}</b> · {h.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Disclosure>
  );
}
