import { eventToItem, type CalItem } from "@/lib/calendar";
import type { ResourceCalendarItem } from "@/lib/types";

/** Busy-only items (plain members) carry no event name. */
export function isBusyItem(item: ResourceCalendarItem): boolean {
  return !("name" in item);
}

/**
 * Calendar items of the resource calendar: "<name> · <calendar>" for staff, "<busy label> ·
 * <calendar>" for busy-only items. Busy items have no id, so the position is used.
 */
export function resourceItems(items: ResourceCalendarItem[], busyLabel: string): CalItem[] {
  return items.map((item, index) => {
    const busy = isBusyItem(item);
    const title = busy ? busyLabel : (item as { name: string }).name;
    const calItem = eventToItem({
      id: busy ? `busy-${index}` : (item as { id: string }).id,
      name: item.calendarName ? `${title} · ${item.calendarName}` : title,
      date: item.date,
      dateEnd: item.dateEnd,
      timeBegin: item.timeBegin,
      timeEnd: item.timeEnd,
      isAllDay: item.isAllDay,
      isDraft: !busy && (item as { isDraft: boolean }).isDraft,
    });
    return { ...calItem, source: item };
  });
}
