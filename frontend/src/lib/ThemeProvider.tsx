import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const THEME_TRANSITION_MS = 250;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());

  const animateNext = useRef(false);
  const transitionTimer = useRef<number | undefined>(undefined);

  // Follow the OS setting while the preference is "system".
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => {
      animateNext.current = false;
      setPrefersDark(e.matches);
    };
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  // Animate only changes the user asked for (setTheme), never the first paint or an OS flip.
  useEffect(() => {
    const root = document.documentElement;
    if (animateNext.current) {
      animateNext.current = false;
      root.setAttribute("data-theme-transition", "");
      window.clearTimeout(transitionTimer.current);
      transitionTimer.current = window.setTimeout(
        () => root.removeAttribute("data-theme-transition"),
        THEME_TRANSITION_MS,
      );
    }
    root.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(
    () => () => {
      window.clearTimeout(transitionTimer.current);
      document.documentElement.removeAttribute("data-theme-transition");
    },
    [],
  );

  useEffect(() => {
    applyThemeColor(theme, resolvedTheme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    writeStoredTheme(next);
    animateNext.current = true;
    setThemeState(next);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
