const KEEP_SECTIONS = new Set([
  "",
  "events",
  "events/export",
  "import",
  "templates",
  "templates/new",
  "more",
  "settings",
  "settings/properties",
  "settings/features",
  "settings/holiday-calendars",
]);

/** Same section of another calendar; calendar-specific sub-pages (an event, a template) fall back to their list. */
export function calendarSwitchPath(pathname: string, clubId: string, calendarId: string): string {
  const base = `/clubs/${clubId}/calendars/`;
  const target = `${base}${calendarId}`;
  if (!pathname.startsWith(base)) return target;
  const [, ...parts] = pathname.slice(base.length).replace(/\/+$/, "").split("/");
  let rest = parts.join("/");
  if (!KEEP_SECTIONS.has(rest)) {
    const head = parts[0] ?? "";
    rest = head === "templates" || head === "events" ? head : "";
    if (rest === "events") rest = parts[1] === "new" ? "" : "events";
  }
  return rest ? `${target}/${rest}` : target;
}
