import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, LangSwitch, toast } from "@/components/ui/shared";
import { useAuth } from "@/lib/auth-context";
import { dateFormatChoices } from "@/lib/profile";
import { useTheme, type ThemePreference } from "@/lib/theme";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const WEEKDAYS = [
  { value: 1, key: "monday" },
  { value: 0, key: "sunday" },
] as const;

/**
 * "Persönliche Einstellungen" (design: Profile): date format, first weekday and language are saved on
 * the account as soon as they change ("Änderungen gelten sofort"); the theme (hell, dunkel, wie
 * System) is a setting of this browser only.
 */
export function PreferencesSection() {
  const { t, i18n } = useTranslation();
  const { user, updateUser } = useAuth();
  const { theme, setTheme } = useTheme();
  // The choice shows immediately; it is taken back when saving fails.
  const [pending, setPending] = useState<{ dateFormat?: string; firstDayOfWeek?: number }>({});
  const dateFormat = pending.dateFormat ?? user?.dateFormat ?? "dd.MM.yyyy";
  const firstDay = pending.firstDayOfWeek ?? user?.firstDayOfWeek ?? 1;

  async function save(data: Parameters<typeof updateUser>[0]) {
    setPending((p) => ({
      ...p,
      ...(data.dateFormat !== undefined && { dateFormat: data.dateFormat }),
      ...(data.firstDayOfWeek !== undefined && { firstDayOfWeek: data.firstDayOfWeek }),
    }));
    const ok = await updateUser(data);
    setPending((p) => {
      const rest = { ...p };
      if (data.dateFormat !== undefined) delete rest.dateFormat;
      if (data.firstDayOfWeek !== undefined) delete rest.firstDayOfWeek;
      return rest;
    });
    // i18n.t: the language itself may just have changed.
    if (ok) toast.success(i18n.t("profile.prefs.saved"));
    else toast.error(i18n.t("profile.prefs.saveFailed"));
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-set">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-set">
            {t("profile.prefs.title")}
          </h2>
          <p>{t("profile.prefs.text")}</p>
        </div>
      </div>
      <div className="ap-stack ap-stack--lg">
        <fieldset className="ap-fieldset">
          <legend>{t("profile.prefs.dateFormat")}</legend>
          {dateFormatChoices().map((f) => (
            <label key={f.value} className="ap-check">
              <input
                type="radio"
                name="pr-date"
                value={f.value}
                checked={dateFormat === f.value}
                onChange={() => void save({ dateFormat: f.value })}
              />
              <span>{f.example}</span>
            </label>
          ))}
        </fieldset>

        <Field group label={t("profile.prefs.firstDay")}>
          <div className="ap-seg">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                aria-pressed={firstDay === d.value}
                onClick={() => firstDay !== d.value && void save({ firstDayOfWeek: d.value })}
              >
                {t(`profile.prefs.${d.key}`)}
              </button>
            ))}
          </div>
        </Field>

        <Field group label={t("profile.prefs.language")}>
          <LangSwitch onChange={(language) => void save({ language })} />
        </Field>

        <Field group label={t("ui.theme.label")} hint={t("profile.prefs.themeHint")}>
          <div className="ap-seg">
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
        </Field>
      </div>
    </section>
  );
}
