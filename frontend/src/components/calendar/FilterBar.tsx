import { useTranslation } from "react-i18next";
import { Button, Field, FilterPillGroup, TextInput } from "@/components/ui/shared";

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  groups: { id: string; label: string }[];
  selectedGroups: string[];
  onToggleGroup: (id: string) => void;
  onReset: () => void;
}

/**
 * Search and target group filter (design: ap-toolbar). Chips are toggle buttons
 * (aria-pressed); "Filter zurücksetzen" appears while a filter or search is active.
 */
export function FilterBar({
  search,
  onSearchChange,
  groups,
  selectedGroups,
  onToggleGroup,
  onReset,
}: FilterBarProps) {
  const { t } = useTranslation();
  const active = selectedGroups.length > 0 || search.trim() !== "";
  return (
    <div className="ap-toolbar">
      <div className="ap-toolbar-search">
        <Field id="calendar-search" label={t("calendar.search.label")}>
          <TextInput
            type="search"
            value={search}
            placeholder={t("calendar.search.placeholder")}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </Field>
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
    </div>
  );
}
