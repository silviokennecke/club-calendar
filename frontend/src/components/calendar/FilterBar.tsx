import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Field, FilterPillGroup, TextInput } from "@/components/ui/shared";

interface FilterBarProps {
  /** Text filter (feed page). Omit it and pass `searchSlot` for a custom search. */
  search?: string;
  onSearchChange?: (value: string) => void;
  /** Replaces the text input, e.g. the server-side calendar search. */
  searchSlot?: ReactNode;
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
  onSearchChange,
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
      <div className="ap-toolbar-search">
        {searchSlot ?? (
          <Field id="calendar-search" label={t("calendar.search.label")}>
            <TextInput
              type="search"
              name="search"
              autoComplete="off"
              spellCheck={false}
              value={search}
              placeholder={t("calendar.search.placeholder")}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          </Field>
        )}
      </div>
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
