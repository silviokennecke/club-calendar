import { useTranslation } from "react-i18next";
import { locationName } from "@/lib/events";
import { templateTimes } from "@/lib/templates";
import type { EventTemplate } from "@/lib/types";

/** One-line summary of a template: "19:00 – 21:00 · Schützenhaus Waldblick" ("Ganztägig" without times). */
export function useTemplateMeta() {
  const { t } = useTranslation();
  return (tpl: EventTemplate) => {
    const times = templateTimes(tpl);
    return [
      times ? t("events.templatePick.meta", times) : t("templates.allDay"),
      tpl.location ? locationName(tpl.location) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  };
}
