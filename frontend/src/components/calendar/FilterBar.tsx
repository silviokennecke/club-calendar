import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, FilterPillGroup } from "@/components/ui/shared";

interface FilterBarProps {
  /** The search (`CalendarSearch`). */
  searchSlot: ReactNode;
  /** Applied search term of the list view; shows "Filter zurücksetzen". */
  search?: string;
  groups: { id: string; label: string }[];
  selectedGroups: string[];
  onToggleGroup: (id: string) => void;
  onReset: () => void;
  /** Extra actions at the end of the bar (e.g. "Termine exportieren" in archived calendars). */
  actions?: ReactNode;
}

/**
 * Search and target group filter (design: ap-toolbar). Chips are toggle buttons
 * (aria-pressed); "Filter zurücksetzen" appears while a filter or search is active.
 */
export function FilterBar({
  search = "",
  searchSlot,
  groups,
  selectedGroups,
  onToggleGroup,
  onReset,
  actions,
}: FilterBarProps) {
  const { t } = useTranslation();
  const active = selectedGroups.length > 0 || search.trim() !== "";
  return (
    <div className="ap-toolbar">
      <div className="ap-toolbar-search">{searchSlot}</div>
      {groups.length > 0 && (
        <FilterPillGroup
          label={t("calendar.filter.label")}
          hideLabel
          items={groups}
          selected={selectedGroups}
          onChange={onToggleGroup}
        />
      )}
      {active && (
        <Button variant="ghost" onClick={onReset}>
          {t("calendar.filter.reset")}
        </Button>
      )}
      {actions && (
        <div className="ap-actions" style={{ marginLeft: "auto" }}>
          {actions}
        </div>
      )}
    </div>
  );
}
