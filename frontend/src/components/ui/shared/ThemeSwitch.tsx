import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useTheme, type ThemePreference } from "@/lib/theme";

const THEMES: ThemePreference[] = ["light", "dark", "system"];

interface ThemeSwitchProps {
  /** Accessible name of the group; omit when a surrounding group (e.g. `Field group`) names it. */
  label?: string;
  className?: string;
}

/** Hell / Dunkel / Wie System as a segmented control (stored in this browser only). */
export function ThemeSwitch({ label, className }: ThemeSwitchProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={cn("ap-seg", className)}
      {...(label ? { role: "group", "aria-label": label } : {})}
    >
      {THEMES.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={theme === option}
          onClick={() => setTheme(option)}
        >
          {t(`ui.theme.${option}`)}
        </button>
      ))}
    </div>
  );
}
