import { useTranslation } from "react-i18next";
import { docNav } from "virtual:docs";
import type { DocMeta, Lang } from "./types";

/** Active UI language as a docs language (German is the fallback). */
export function useDocLang(): Lang {
  const { i18n } = useTranslation();
  return (i18n.resolvedLanguage ?? i18n.language ?? "de").startsWith("en") ? "en" : "de";
}

export function navFor(lang: Lang): DocMeta[] {
  return docNav[lang]?.length ? docNav[lang] : docNav.de;
}

/** Page of the language, or the German page when this language lacks the slug. */
export function resolveDoc(lang: Lang, slug: string): { lang: Lang; meta: DocMeta } | null {
  for (const l of lang === "de" ? (["de"] as const) : ([lang, "de"] as const)) {
    const meta = docNav[l]?.find((m) => m.slug === slug);
    if (meta) return { lang: l, meta };
  }
  return null;
}

const humanize = (folder: string) =>
  folder.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export interface NavGroup {
  section: string;
  /** Title of the section's own index page, else the humanised folder name; "" for root pages. */
  title: string;
  /** Section index page (slug equals the folder), if present. */
  indexPage?: DocMeta;
  pages: DocMeta[];
}

export function groupNav(nav: DocMeta[]): NavGroup[] {
  const groups = new Map<string, NavGroup>();
  for (const meta of nav) {
    let g = groups.get(meta.section);
    if (!g) {
      g = { section: meta.section, title: meta.section ? humanize(meta.section) : "", pages: [] };
      groups.set(meta.section, g);
    }
    if (meta.section && meta.slug === meta.section) {
      g.title = meta.title;
      g.indexPage = meta;
    }
    g.pages.push(meta);
  }
  return [...groups.values()];
}

export function sectionTitles(nav: DocMeta[]): Record<string, string> {
  return Object.fromEntries(groupNav(nav).map((g) => [g.section, g.title]));
}
