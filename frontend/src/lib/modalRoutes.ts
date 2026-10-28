import { matchPath } from "react-router-dom";
import { isValidIso } from "@/lib/calendar";
import { isLegalType, type LegalType } from "@/lib/legal";
import { publicBackPath } from "@/lib/feeds/public";

/**
 * Routed modals (background-location pattern): the event dialogs and the public event detail
 * have their own, shareable URLs but render as a dialog above a background page.
 *
 * Router state of a modal entry:
 * - `background`: path (+ query) of the page below the dialog. Public pages store it without the
 *   feed secret (history state is no place for it); the secret is added again from the address.
 * - `direct`: the modal was not opened from the background page (deep link, reload in a new tab);
 *   closing then replaces the entry instead of going back in history.
 */
export interface ModalNavState {
  background?: string;
  direct?: boolean;
}

export type ModalMatch =
  | { kind: "event"; clubId: string; calendarId: string; base: string }
  | { kind: "public"; feedId: string; eventId: string }
  | { kind: "legal"; type: LegalType };

const CAL = "/clubs/:clubId/calendars/:calendarId";
const EVENT_PATTERNS = [
  `${CAL}/events/new/form`,
  `${CAL}/events/new/template`,
  `${CAL}/events/new/template/:templateId`,
  `${CAL}/events/:eventId`,
  `${CAL}/events/:eventId/series`,
];
/** Pages below …/events/ that are not an event id. */
const NOT_EVENT_IDS = new Set(["new", "export"]);

/** Which modal (if any) the path shows. */
export function matchModal(pathname: string): ModalMatch | null {
  for (const pattern of EVENT_PATTERNS) {
    const m = matchPath(pattern, pathname);
    if (!m) continue;
    const { clubId = "", calendarId = "", eventId } = m.params;
    if (pattern.includes(":eventId") && NOT_EVENT_IDS.has(eventId ?? "")) continue;
    return { kind: "event", clubId, calendarId, base: `/clubs/${clubId}/calendars/${calendarId}` };
  }
  const pub = matchPath("/feed/:feedId/events/:eventId", pathname);
  if (pub) return { kind: "public", feedId: pub.params.feedId!, eventId: pub.params.eventId! };
  const legal = matchPath("/:type", pathname);
  if (legal && isLegalType(legal.params.type ?? "")) {
    return { kind: "legal", type: legal.params.type as LegalType };
  }
  return null;
}

interface LocationLike {
  pathname: string;
  search: string;
  state?: unknown;
}

export function modalState(location: LocationLike): ModalNavState {
  const s = location.state as ModalNavState | null | undefined;
  return s && typeof s === "object" ? s : {};
}

function validStored(stored: unknown): string | null {
  if (
    typeof stored === "string" &&
    stored.startsWith("/") &&
    !stored.startsWith("//") &&
    !matchModal(stored.split("?")[0]!)
  ) {
    return stored;
  }
  return null;
}

/**
 * The page below a modal URL, or null if the location is no modal. Without router state (deep
 * link) the calendar (with `?date=` of the dialog) resp. the public feed is the background.
 */
export function modalBackground(location: LocationLike): string | null {
  const match = matchModal(location.pathname);
  if (!match) return null;
  const params = new URLSearchParams(location.search);
  const stored = modalState(location).background;

  if (match.kind === "legal") {
    // A modal only above a page that opened it; a direct call is the standalone page.
    return validStored(stored);
  }

  if (match.kind === "public") {
    // Same feed only, never a stored secret; the address's secret is added again.
    return publicBackPath(match.feedId, params.get("secret") || undefined, stored);
  }

  const valid = validStored(stored);
  if (valid) return valid;
  const date = params.get("date");
  return isValidIso(date) ? `${match.base}?date=${date}` : match.base;
}

/** Router state for links / navigation that open a modal above the current page. */
export function openModalState(location: { pathname: string; search: string }): ModalNavState {
  return { background: location.pathname + location.search };
}
