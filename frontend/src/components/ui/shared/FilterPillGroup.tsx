import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Chip } from "./ChipSelect";

interface FilterItem {
  id: string;
  label: string;
}

interface Props {
  label?: string;
  /** Use `label` only as the group's accessible name (no visible caption). */
  hideLabel?: boolean;
  clearAllLabel?: string;
  items: FilterItem[];
  selected: string[];
  onChange: (id: string) => void;
  onClearAll?: () => void;
  className?: string;
}

/** Filter chips (aria-pressed) with an optional "all" chip. */
export function FilterPillGroup({
  label,
  hideLabel,
  clearAllLabel,
  items,
  selected,
  onChange,
  onClearAll,
  className,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className={cn("ap-chips", className)} role="group" aria-label={label}>
      {label && !hideLabel && (
        <span className="t-sm t-muted" aria-hidden="true">
          {label}
        </span>
      )}
      {onClearAll && (
        <Chip pressed={selected.length === 0} onClick={onClearAll}>
          {clearAllLabel ?? t("common.all")}
        </Chip>
      )}
      {items.map((item) => (
        <Chip key={item.id} pressed={selected.includes(item.id)} onClick={() => onChange(item.id)}>
          {item.label}
        </Chip>
      ))}
    </div>
  );
}
