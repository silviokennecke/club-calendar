import type { useEventPage } from "./useEventPage";

type EventPage = ReturnType<typeof useEventPage>;

/**
 * State of the "create event" dialogs before their content: the calendar is still loading, or it
 * is archived (read-only: a direct call of …/events/new* shows a notice instead of a form whose
 * save the backend would reject), or it could not be loaded (unknown, no access, network).
 */
export type CreateGate = "loading" | "archived" | "failed" | null;

export function createGate(page: EventPage): CreateGate {
  if (page.calendarLoading) return "loading";
  if (page.calendarFailed) return "failed";
  return page.isArchived ? "archived" : null;
}
