import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "../locales/en.json";
import de from "../locales/de.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "de"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "language",
    },
    interpolation: { escapeValue: false },
  });

// Keep <html lang> in sync for screen readers and hyphenation.
function syncHtmlLang(lng: string | undefined) {
  if (typeof document !== "undefined" && lng) document.documentElement.lang = lng.slice(0, 2);
}
syncHtmlLang(i18n.resolvedLanguage);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
