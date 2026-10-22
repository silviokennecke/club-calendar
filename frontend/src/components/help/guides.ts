export const HELP_APPS = ["ios", "macos", "outlook", "google"] as const;
export type HelpApp = (typeof HELP_APPS)[number];

export interface GuideStep {
  /** Key below `helpSubscribe.<app>.steps`; the screenshot is `public/help/<app>-<position>.png`. */
  id: string;
}

export interface Guide {
  steps: readonly GuideStep[];
}

const steps = (...ids: string[]): GuideStep[] => ids.map((id) => ({ id }));

/** Adding a step: one id here plus its `text` and `alt` in both locale files. */
export const GUIDES: Record<HelpApp, Guide> = {
  ios: { steps: steps("settings", "apps", "accounts", "other", "paste", "next", "save") },
  macos: { steps: steps("open", "menu", "paste", "name", "refresh", "ok") },
  outlook: { steps: steps("open", "add", "internet", "paste", "name", "import") },
  google: { steps: steps("open", "plus", "url", "paste", "add") },
};

export function isHelpApp(value: string | null): value is HelpApp {
  return (HELP_APPS as readonly string[]).includes(value ?? "");
}

export function screenshotSrc(app: HelpApp, position: number): string {
  return `/help/${app}-${position}.png`;
}
