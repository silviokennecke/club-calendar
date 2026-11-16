import { useTranslation } from "react-i18next";
import { Banner } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";
import { formatWeekdayDate, type ResourceConflict } from "@/lib/events";

function useWhen() {
  const { t } = useTranslation();
  const locale = useLocale();
  return (c: ResourceConflict) => {
    const from = formatWeekdayDate(c.date.slice(0, 10), locale);
    const to =
      c.dateEnd && c.dateEnd !== c.date ? formatWeekdayDate(c.dateEnd.slice(0, 10), locale) : null;
    if (c.isAllDay)
      return to
        ? `${from} – ${to}, ${t("events.conflicts.allDay")}`
        : `${from}, ${t("events.conflicts.allDay")}`;
    return to
      ? `${from} ${c.timeBegin} – ${to} ${c.timeEnd}`
      : `${from}, ${c.timeBegin}–${c.timeEnd}`;
  };
}

function Items({ items }: { items: ResourceConflict[] }) {
  const { t } = useTranslation();
  const when = useWhen();
  const locale = useLocale();
  return (
    <ul className="m-0 list-disc pl-5">
      {items.map((c, i) => (
        <li key={`${c.resourceId}-${c.eventId ?? c.date}-${c.timeBegin}-${i}`}>
          {[
            c.forDate
              ? t("events.conflicts.forDate", {
                  date: formatWeekdayDate(c.forDate.slice(0, 10), locale),
                })
              : null,
            `${c.resourceName}: ${c.calendarName}`,
            when(c),
            t(c.kind === "buffer" ? "events.conflicts.buffer" : "events.conflicts.overlap"),
            c.isDraft ? t("events.conflicts.draft") : null,
            c.eventName ?? null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </li>
      ))}
    </ul>
  );
}

/**
 * Resource conflicts as banners: errors (publishing is refused) in red, warnings in yellow.
 * `failed` marks the answer of a refused save (title: "not saved").
 */
export function ResourceConflictList({
  conflicts,
  failed = false,
}: {
  conflicts: ResourceConflict[];
  failed?: boolean;
}) {
  const { t } = useTranslation();
  const errors = conflicts.filter((c) => c.severity === "error");
  const warnings = conflicts.filter((c) => c.severity !== "error");
  if (conflicts.length === 0) return null;
  return (
    <div className="ap-stack">
      {errors.length > 0 && (
        <Banner
          tone="danger"
          title={t(failed ? "events.conflicts.errorFailedTitle" : "events.conflicts.errorTitle")}
        >
          <Items items={errors} />
          <p>{t("events.conflicts.errorHint")}</p>
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warning" title={t("events.conflicts.warningTitle")}>
          <Items items={warnings} />
        </Banner>
      )}
    </div>
  );
}
