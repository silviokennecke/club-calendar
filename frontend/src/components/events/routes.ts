/** URLs of the event pages below a calendar (all routes are defined in src/App.tsx). */
export function eventRoutes(base: string) {
  const withDate = (path: string, date?: string | null, extra?: Record<string, string>) => {
    const q = new URLSearchParams(extra);
    if (date) q.set("date", date);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return {
    list: `${base}/events`,
    /** Choice: blank / from template / import (design: EventNew). */
    create: (date?: string | null) => withDate(`${base}/events/new`, date),
    /** Blank form (design: EventNewForm); `templateId` pre-fills it from a template. */
    form: (date?: string | null, templateId?: string) =>
      withDate(`${base}/events/new/form`, date, templateId ? { templateId } : undefined),
    /** Template picker (design: EventNewTemplate). */
    pickTemplate: (date?: string | null) => withDate(`${base}/events/new/template`, date),
    /** Single event or series from a template (design: EventSeries). */
    fromTemplate: (templateId: string, date?: string | null) =>
      withDate(`${base}/events/new/template/${templateId}`, date),
    edit: (eventId: string) => `${base}/events/${eventId}`,
    export: `${base}/events/export`,
    import: `${base}/import`,
    templates: `${base}/templates`,
    /** New template (design: TemplateEdit, mode new). */
    templateNew: `${base}/templates/new`,
    /** Edit a template (design: TemplateEdit). */
    template: (templateId: string) => `${base}/templates/${templateId}`,
    feeds: `${base}/settings/feeds`,
    /** New feed (design: FeedEdit, mode new). */
    feedNew: `${base}/settings/feeds/new`,
    /** Edit a feed (design: FeedEdit). */
    feed: (feedId: string) => `${base}/settings/feeds/${feedId}`,
  };
}

/** Router state of the pages below a calendar (templates, feeds): where "close" / "save" return to. */
export interface EventNavState {
  from?: string;
}
