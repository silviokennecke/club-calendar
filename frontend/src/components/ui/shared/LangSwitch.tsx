import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export const SUPPORTED_LANGUAGES = ["de", "en"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

interface LangSwitchProps {
  /** Called after the UI language changed (e.g. to persist it on the user). */
  onChange?: (lang: Language) => void;
  className?: string;
}

/** Segmented language switch bound to i18next. Labels are endonyms with a lang attribute. */
export function LangSwitch({ onChange, className }: LangSwitchProps) {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? "en").slice(0, 2);

  return (
    <div className={cn("ap-seg", className)} role="group" aria-label={t("ui.langSwitch.label")}>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          aria-pressed={current === lang}
          onClick={() => {
            if (current === lang) return;
            void i18n.changeLanguage(lang);
            onChange?.(lang);
          }}
        >
          {t(`ui.langSwitch.${lang}`)}
        </button>
      ))}
    </div>
  );
}
