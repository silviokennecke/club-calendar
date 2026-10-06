import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import de from "../locales/de.json";

// German (the design's source language) is bundled; English is a lazy chunk, loaded only when it is
// the detected or chosen language. Both files have the same keys (src/lib/__tests__/i18n.test.ts),
// so German needs no fallback and never pulls in the English file.
const lazyLocales: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    if (language !== "en") {
      callback(new Error(`No translations for "${language}"`), false);
      return;
    }
    import("../locales/en.json").then(
      (m) => callback(null, m.default),
      (error: Error) => callback(error, false),
    );
  },
};

/** Resolves once the detected language's texts are there (main.tsx renders after it). */
export const i18nReady = i18n
  .use(LanguageDetector)
  .use(lazyLocales)
  .use(initReactI18next)
  .init({
    resources: {
      de: { translation: de },
    },
    partialBundledLanguages: true,
    // Unsupported browser languages resolve to English, as before. English falls back to the
    // bundled German when its chunk cannot be loaded (switch while offline / after a deploy).
    fallbackLng: { de: [], en: ["de"], default: ["en"] },
    supportedLngs: ["en", "de"],
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "language",
    },
    interpolation: { escapeValue: false },
  });

// Keep <html lang> in sync for screen readers and hyphenation. `resolvedLanguage` is the language
// of the texts actually shown (German while the English chunk failed to load).
function syncHtmlLang(lng: string | undefined) {
  const shown = i18n.resolvedLanguage ?? lng;
  if (typeof document !== "undefined" && shown) document.documentElement.lang = shown.slice(0, 2);
}
syncHtmlLang(i18n.resolvedLanguage);
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
