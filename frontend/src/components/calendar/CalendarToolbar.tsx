import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CalendarView } from "@/lib/calendar";
import { SplitButton, StatusBadge } from "@/components/ui/shared";
import { MonthNav } from "./MonthNav";

interface CalendarToolbarProps {
  view: CalendarView;
  /** Month or week title; announced politely when it changes. */
  title: string;
  titleId: string;
  /** Links of the view switch (month / week keep the date; list is the events page). */
  monthHref: string;
  weekHref: string;
  listHref: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  archived?: boolean;
  /** Create actions; omitted when the calendar is read-only. */
  onCreate?: () => void;
  onCreateFromTemplate?: () => void;
  importHref?: string;
}

/**
 * Page head of the calendar (design: Calendar.dc.html): title with previous / today / next,
 * the view switch as links and the split button "Termin anlegen".
 */
export function CalendarToolbar({
  view,
  title,
  titleId,
  monthHref,
  weekHref,
  listHref,
  onPrev,
  onNext,
  onToday,
  archived,
  onCreate,
  onCreateFromTemplate,
  importHref,
}: CalendarToolbarProps) {
  const { t } = useTranslation();
  const week = view === "week";
  return (
    <header className="ap-pagehead">
      <MonthNav
        title={title}
        titleId={titleId}
        unit={view}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        badge={archived ? <StatusBadge status="archived" /> : undefined}
      />
      <div className="ap-actions">
        <nav className="ap-seg ap-hide-m" aria-label={t("calendar.viewSwitch")}>
          <Link to={monthHref} aria-current={!week ? "page" : undefined}>
            {t("calendar.views.month")}
          </Link>
          <Link to={weekHref} aria-current={week ? "page" : undefined}>
            {t("calendar.views.week")}
          </Link>
          <Link to={listHref}>{t("calendar.views.list")}</Link>
        </nav>
        {onCreate && (
          <SplitButton
            className="ap-hide-m"
            icon="plus"
            label={t("calendar.create")}
            onClick={onCreate}
            menuLabel={t("calendar.createMore")}
            items={[
              ...(onCreateFromTemplate
                ? [
                    {
                      key: "template",
                      icon: "layers" as const,
                      label: t("calendar.fromTemplate"),
                      onSelect: onCreateFromTemplate,
                    },
                  ]
                : []),
              ...(importHref
                ? [
                    {
                      key: "import",
                      icon: "upload" as const,
                      label: t("calendar.import"),
                      to: importHref,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </div>
    </header>
  );
}
