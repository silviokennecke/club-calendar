export type ProfileTabKey = "account" | "security" | "apps" | "privacy";

export interface ProfileTab {
  key: ProfileTabKey;
  labelKey: string;
  href: string;
}

export const PROFILE_TABS: ProfileTab[] = [
  { key: "account", labelKey: "profile.tabs.account", href: "/profile" },
  { key: "security", labelKey: "profile.tabs.security", href: "/profile/security" },
  { key: "apps", labelKey: "profile.tabs.apps", href: "/profile/apps" },
  { key: "privacy", labelKey: "profile.tabs.privacy", href: "/profile/privacy" },
];

const TAB_OF_ANCHOR: Record<string, ProfileTabKey> = {
  "pr-account": "account",
  "pr-set": "account",
  "pr-pw": "security",
  "pr-sso": "security",
  "pr-mfa": "security",
  "pr-sessions": "security",
  "pr-subscription": "apps",
  "pr-apps": "apps",
  "pr-legal": "privacy",
  "pr-danger": "privacy",
};

/** Tab that holds the section of an old `/profile#pr-…` link (null = no or unknown hash). */
export function profileTabForHash(hash: string): ProfileTab | null {
  const key = TAB_OF_ANCHOR[hash.replace(/^#/, "")];
  return PROFILE_TABS.find((tab) => tab.key === key) ?? null;
}

/** Parameters the API appends to `/profile` after the SSO link flow; they belong to the security tab. */
export const LINK_PARAMS = ["linked", "link_error", "link_provider", "link_proof"];
