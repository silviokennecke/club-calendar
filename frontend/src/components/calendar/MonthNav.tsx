import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, IconButton } from "@/components/ui/shared";

interface MonthNavProps {
  title: string;
  titleId: string;
  /** Heading level of the title (h1 on the calendar page, h2 when embedded). */
  as?: "h1" | "h2";
  unit?: "month" | "week";
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** Extra content after the title (e.g. the archived badge). */
  badge?: ReactNode;
}

/** Title with previous / today / next (design: ap-monthnav); the title is a polite live region. */
export function MonthNav({
  title,
  titleId,
  as: Heading = "h1",
  unit = "month",
  onPrev,
  onNext,
  onToday,
  badge,
}: MonthNavProps) {
  const { t } = useTranslation();
  const week = unit === "week";
  return (
    <div className="ap-monthnav">
      <Heading id={titleId} className={Heading === "h1" ? "t-h1" : "t-h2"} aria-live="polite">
        {title}
      </Heading>
      {badge}
      <IconButton
        variant="outline"
        icon="chevron-left"
        label={week ? t("calendar.prevWeek") : t("calendar.prevMonth")}
        onClick={onPrev}
      />
      <Button variant="secondary" onClick={onToday}>
        {t("calendar.today")}
      </Button>
      <IconButton
        variant="outline"
        icon="chevron-right"
        label={week ? t("calendar.nextWeek") : t("calendar.nextMonth")}
        onClick={onNext}
      />
    </div>
  );
}
