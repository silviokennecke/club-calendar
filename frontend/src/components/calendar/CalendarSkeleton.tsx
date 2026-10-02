import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/shared";

const SEVEN = [0, 1, 2, 3, 4, 5, 6];
const ROWS = [0, 1, 2, 3, 4];

/** Loading placeholder in the shape of the month grid (design: CalendarStates a). */
export function CalendarSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="ap-panel" aria-busy="true">
      <p className="ap-sr" role="status">
        {t("calendar.loading")}
      </p>
      <div className="ap-stack" aria-hidden="true">
        <div className="grid grid-cols-7 gap-2">
          {SEVEN.map((i) => (
            <Skeleton key={i} style={{ height: 20 }} />
          ))}
        </div>
        {ROWS.map((r) => (
          <div key={r} className="grid grid-cols-7 gap-2">
            {SEVEN.map((i) => (
              <Skeleton key={i} style={{ height: 72 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
