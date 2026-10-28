/**
 * URLs of the event pages below a calendar (all routes are defined in src/App.tsx). The feed pages are
 * club settings (`/clubs/:clubId/settings/feeds…`), derived from the calendar `base`.
 */
export function eventRoutes(base: string) {
  const clubFeeds = `${base.replace(/\/calendars\/[^/]*$/, "")}/settings/feeds`;
  const withDate = (path: string, date?: string | null, extra?: Record<string, string>) => {
    const q = new URLSearchParams(extra);
    if (date) q.set("date", date);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return {
    list: `${base}/events`,
    /** Blank form (design: EventNewForm); `templateId` pre-fills it from a template. */
    form: (date?: string | null, templateId?: string) =>
      withDate(`${base}/events/new/form`, date, templateId ? { templateId } : undefined),
    /** Template picker (design: EventNewTemplate). */
    pickTemplate: (date?: string | null) => withDate(`${base}/events/new/template`, date),
    /** Single event or series from a template (design: EventSeries). */
    fromTemplate: (templateId: string, date?: string | null) =>
      withDate(`${base}/events/new/template/${templateId}`, date),
    edit: (eventId: string) => `${base}/events/${eventId}`,
    /** "Reihe ändern": new rule for the series of an event (step of the edit dialog). */
    editSeries: (eventId: string) => `${base}/events/${eventId}/series`,
    export: `${base}/events/export`,
    import: `${base}/import`,
    templates: `${base}/templates`,
    /** New template (design: TemplateEdit, mode new). */
    templateNew: `${base}/templates/new`,
    /** Edit a template (design: TemplateEdit). */
    template: (templateId: string) => `${base}/templates/${templateId}`,
    feeds: clubFeeds,
    /** New feed (design: FeedEdit, mode new). */
    feedNew: `${clubFeeds}/new`,
    /** Edit a feed (design: FeedEdit). */
    feed: (feedId: string) => `${clubFeeds}/${feedId}`,
  };
}

/** Router state of the pages below a calendar (templates, feeds): where "close" / "save" return to. */
export interface EventNavState {
  from?: string;
}
