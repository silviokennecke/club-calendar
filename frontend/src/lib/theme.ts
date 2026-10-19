import { createContext, useContext } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** localStorage key; keep in sync with the inline script in index.html. */
export const THEME_STORAGE_KEY = "theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

export interface ThemeContextValue {
  /** The user's choice (may be "system"). */
  theme: ThemePreference;
  /** The theme actually applied to <html data-theme>. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function writeStoredTheme(theme: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode, blocked) – keep the in-memory choice */
  }
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveTheme(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

const THEME_COLORS = { light: "#f7f8f5", dark: "#0f1715" } as const;

/**
 * Keeps `<meta name="theme-color">` in step with the theme (mirrors public/theme-init.js):
 * a forced theme overrides the media-query metas, "system" restores them.
 */
export function applyThemeColor(preference: ThemePreference, resolved: ResolvedTheme) {
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  metas.forEach((meta, i) => {
    if (preference === "system") {
      const scheme = i === 0 ? "light" : "dark";
      meta.setAttribute("content", THEME_COLORS[scheme]);
      meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    } else {
      meta.setAttribute("content", THEME_COLORS[resolved]);
      meta.removeAttribute("media");
    }
  });
}
