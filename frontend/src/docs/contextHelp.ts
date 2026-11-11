import { useLocation } from "react-router-dom";
import { helpPath } from "./paths";
import type { DocSlug } from "./slugs.generated";

interface ContextHelp {
  page: DocSlug;
  anchor?: string;
}

type Rule = [pattern: RegExp, resolve: (params: URLSearchParams) => ContextHelp | DocSlug];

const CAL = String.raw`^/clubs/[^/]+/calendars/[^/]+`;
const CLUB = String.raw`^/clubs/[^/]+`;

// First match wins: specific routes before general ones.
const RULES: Rule[] = [
  [
    /^\/(login|signup|verify-email|auth\/verify-email|auth\/callback)\/?$/,
    () => "getting-started/sign-up",
  ],
  [/^\/(forgot-password|reset-password)\/?$/, () => "settings/password"],
  [/^\/invitations\/?$/, () => "team/invitations"],
  [/^\/(imprint|privacy|terms)\/?$/, () => "settings/consent"],
  [/^\/oauth\/consent\/?$/, () => "ai-assistants/connect"],
  [/^\/profile\/?$/, () => "settings/profile"],
  [/^\/clubs\/?$/, () => "settings/club"],
  [/^\/setup\/?$/, () => "getting-started/set-up"],
  [new RegExp(`${CAL}/events/export/?$`), () => "organize/export"],
  [new RegExp(`${CAL}/events/new(/|$)`), () => "events/first-event"],
  [new RegExp(`${CAL}/events/[^/]+(/|$)`), () => "events/edit"],
  [new RegExp(`${CAL}/events/?$`), () => "events/event-list"],
  [new RegExp(`${CAL}/import/?$`), () => "organize/import"],
  [new RegExp(`${CAL}/templates(/|$)`), () => "organize/templates"],
  [new RegExp(`${CAL}/settings/properties/?$`), () => "organize/properties"],
  [new RegExp(`${CAL}/settings/features/?$`), () => "organize/features"],
  [new RegExp(`${CAL}/settings/holiday-calendars/?$`), () => "organize/holidays"],
  [new RegExp(`${CAL}/settings/?$`), () => "settings/calendar-settings"],
  [new RegExp(`${CAL}/more/?$`), () => "getting-started/tour"],
  [new RegExp(`${CAL}/?$`), () => "events/views"],
  [new RegExp(`${CLUB}/settings/locations/?$`), () => "organize/locations"],
  [new RegExp(`${CLUB}/settings/target-groups/?$`), () => "organize/target-groups"],
  [new RegExp(`${CLUB}/settings/feeds/(new|[^/]+)/?$`), () => "publishing/create-feed"],
  [new RegExp(`${CLUB}/settings/feeds/?$`), () => "publishing/feeds"],
  [
    new RegExp(`${CLUB}/me(/|$)`),
    (q) => (q.get("tab") === "subscription" ? "publishing/subscribe" : "getting-started/my-club"),
  ],
  [
    new RegExp(`${CLUB}/?$`),
    (q) => {
      const tab = q.get("tab");
      if (tab === "calendars") return "settings/calendars";
      if (tab === "members") return "team/members";
      return "settings/club";
    },
  ],
];

/** Help page matching an app route (`/help` start page for routes without a fitting page). */
export function contextHelp(pathname: string, search = ""): ContextHelp {
  const params = new URLSearchParams(search);
  for (const [pattern, resolve] of RULES) {
    if (pattern.test(pathname)) {
      const r = resolve(params);
      return typeof r === "string" ? { page: r } : r;
    }
  }
  return { page: "index" };
}

export function contextHelpPath(pathname: string, search = ""): string {
  const { page, anchor } = contextHelp(pathname, search);
  return helpPath(page, anchor);
}

/** Help URL for the page the user is on right now. */
export function useContextHelpUrl(): string {
  const { pathname, search } = useLocation();
  return contextHelpPath(pathname, search);
}
