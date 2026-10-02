import { useTranslation } from "react-i18next";

/** The current UI language as an Intl locale ("de" / "en"). */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? "de").slice(0, 2);
}
