import { useTranslation } from "react-i18next";
import { Icon } from "@/components/ui/shared";

interface Props {
  showHoliday?: boolean;
  /** Adds the drag hint (only where events can be moved). */
  showDragHint?: boolean;
}

/** Explains the chip styles (design: ap-legend). */
export function CalendarLegend({ showHoliday = true, showDragHint }: Props) {
  const { t } = useTranslation();
  return (
    <div className="ap-legend">
      <span>
        <i className="ap-sw ap-sw--published" aria-hidden="true" />
        {t("calendar.legend.published")}
      </span>
      <span>
        <i className="ap-sw ap-sw--draft" aria-hidden="true" />
        {t("calendar.legend.draft")}
      </span>
      {showHoliday && (
        <span>
          <i className="ap-sw ap-sw--holiday" aria-hidden="true" />
          {t("calendar.legend.holiday")}
        </span>
      )}
      {showDragHint && (
        <span>
          <Icon glyph="move" size={16} />
          {t("calendar.legend.drag")}
        </span>
      )}
    </div>
  );
}
