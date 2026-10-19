import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DARK_QUERY,
  applyThemeColor,
  ThemeContext,
  readStoredTheme,
  resolveTheme,
  systemPrefersDark,
  writeStoredTheme,
  type ThemePreference,
} from "./theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  // Follow the OS setting while the preference is "system".
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    applyThemeColor(theme, resolvedTheme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    writeStoredTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
