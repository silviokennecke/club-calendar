import type { TFunction } from "i18next";
import type { CalItem } from "@/lib/calendar";
import type { TagTone } from "@/components/ui/shared";

export type ItemStatus = "published" | "draft" | "holiday";

export function itemStatus(item: Pick<CalItem, "kind" | "isDraft">): ItemStatus {
  if (item.kind === "holiday") return "holiday";
  return item.isDraft ? "draft" : "published";
}

/** "19:00 bis 21:00 Uhr", "Ganztägig" or "Feiertag". */
export function itemTimeText(item: CalItem, t: TFunction): string {
  if (item.kind === "holiday") return t("calendar.time.holiday");
  if (item.allDay || !item.timeBegin) return t("calendar.time.allDay");
  return t("calendar.time.range", { from: item.timeBegin, to: item.timeEnd ?? item.timeBegin });
}

/** Tooltip / accessible summary: "Training, 19:00 bis 21:00 Uhr (veröffentlicht)". */
export function itemSummary(item: CalItem, t: TFunction): string {
  if (item.kind === "holiday") return t("calendar.chip.holidayTip", { name: item.title });
  const status = item.isDraft ? `(${t("calendar.chip.draft")})` : t("calendar.chip.published");
  return `${item.title}, ${itemTimeText(item, t)} ${status}`;
}

const AUDIENCE_TONES: TagTone[] = ["youth", "adult", "senior"];

/** Stable tag colour for a target group by its position in the calendar's list. */
export function audienceTone(index: number): TagTone {
  return index < 0 ? "neutral" : AUDIENCE_TONES[index % AUDIENCE_TONES.length];
}
