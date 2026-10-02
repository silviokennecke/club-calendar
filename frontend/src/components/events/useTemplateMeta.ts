import { useTranslation } from "react-i18next";
import { locationName } from "@/lib/events";
import type { EventTemplate } from "@/lib/types";

/** One-line summary of a template: "19:00 – 21:00 · Schützenhaus Waldblick". */
export function useTemplateMeta() {
  const { t } = useTranslation();
  return (tpl: EventTemplate) =>
    [
      t("events.templatePick.meta", {
        from: tpl.timeBegin.slice(0, 5),
        to: tpl.timeEnd.slice(0, 5),
      }),
      tpl.location ? locationName(tpl.location) : null,
    ]
      .filter(Boolean)
      .join(" · ");
}
