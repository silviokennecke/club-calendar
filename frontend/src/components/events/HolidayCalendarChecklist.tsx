import { useTranslation } from "react-i18next";
import { Tag } from "@/components/ui/shared";

import type { HolidayCalendar } from "@/lib/types";

interface Props {
  items: HolidayCalendar[];
  /** Selected ids. */
  selected: string[];
  onChange: (ids: string[]) => void;
  legend: string;
  idPrefix: string;
}

/** Checkbox list of holiday calendars with their type as a tag. */
export function HolidayCalendarChecklist({ items, selected, onChange, legend, idPrefix }: Props) {
  const { t } = useTranslation();
  return (
    <fieldset className="ap-fieldset">
      <legend>{legend}</legend>
      {items.map((h) => (
        <label key={h.id} className="ap-check" htmlFor={`${idPrefix}-${h.id}`}>
          <input
            id={`${idPrefix}-${h.id}`}
            type="checkbox"
            checked={selected.includes(h.id)}
            onChange={(e) =>
              onChange(e.target.checked ? [...selected, h.id] : selected.filter((x) => x !== h.id))
            }
          />
          <span>
            {h.name} {h.type && <Tag>{t(`events.holidayType.${h.type}`)}</Tag>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
