import type { useEventPage } from "./useEventPage";

type EventPage = ReturnType<typeof useEventPage>;

/**
 * State of the "create event" dialogs before their content: the calendar is still loading, or it
 * is archived (read-only: a direct call of …/events/new* shows a notice instead of a form whose
 * save the backend would reject), or the club role may not write (viewer: "forbidden"), or it could not be loaded (unknown, no access, network).
 */
export type CreateGate = "loading" | "archived" | "failed" | "forbidden" | null;

export function createGate(page: EventPage): CreateGate {
  if (page.calendarLoading) return "loading";
  if (page.calendarFailed) return "failed";
  if (page.isArchived) return "archived";
  if (page.roleLoading) return "loading";
  return page.roleCanEdit ? null : "forbidden";
}

/** Dialog title while gated: archived / forbidden notice, else the regular title. */
export function gateTitle(gate: CreateGate, t: (key: string) => string, title: string): string {
  if (gate === "archived") return t("events.new.archived.title");
  if (gate === "forbidden") return t("events.new.forbidden.title");
  return title;
}
