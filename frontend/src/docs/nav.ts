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

const langOrder = (lang: Lang): Lang[] => (lang === "de" ? ["de"] : [lang, "de"]);

/** Page of the language, or the German page when this language lacks the slug. */
export function resolveDoc(lang: Lang, slug: string): { lang: Lang; meta: DocMeta } | null {
  for (const l of langOrder(lang)) {
    const meta = docNav[l]?.find((m) => m.slug === slug);
    if (meta) return { lang: l, meta };
  }
  return null;
}

export interface SectionEntry {
  /** URL slug: a page slug, or the folder path for a child folder. */
  slug: string;
  kind: "page" | "folder";
  title: string;
  description?: string;
  order: number;
}

export type HelpTarget =
  | { kind: "page"; lang: Lang; meta: DocMeta }
  | { kind: "section"; lang: Lang; folder: string; title: string; entries: SectionEntry[] };

/** `/help/a/b/` (or a router splat) to a clean slug path; "" is the root. */
export function normalizeHelpPath(raw: string): string {
  const path = raw
    .split(/[?#]/)[0]
    .replace(/^\/+/, "")
    .replace(/^help(?=\/|$)/, "");
  return path.split("/").filter(Boolean).join("/");
}

const lastSegment = (folder: string) => humanize(folder.split("/").pop() ?? folder);

function resolveIn(nav: DocMeta[], lang: Lang, path: string): HelpTarget | null {
  const bySlug = (slug: string) => nav.find((m) => m.slug === slug);
  const page = bySlug(path || "index") ?? (path ? bySlug(`${path}/index`) : undefined);
  if (page) return { kind: "page", lang, meta: page };
  if (!path) return null;

  const prefix = `${path}/`;
  const below = nav.filter((m) => m.slug.startsWith(prefix));
  if (below.length === 0) return null;
  const entries = new Map<string, SectionEntry>();
  for (const m of below) {
    const rest = m.slug.slice(prefix.length);
    if (rest === "index") continue;
    const [head, ...tail] = rest.split("/");
    if (tail.length === 0) {
      entries.set(m.slug, {
        slug: m.slug,
        kind: "page",
        title: m.title,
        description: m.description,
        order: m.order,
      });
      continue;
    }
    const folder = prefix + head;
    const own = bySlug(`${folder}/index`);
    const prev = entries.get(folder);
    const order = own?.order ?? Math.min(prev?.order ?? Infinity, m.order);
    entries.set(folder, {
      slug: folder,
      kind: "folder",
      title: own?.title ?? lastSegment(folder),
      description: own?.description,
      order,
    });
  }
  const list = [...entries.values()].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title),
  );
  return { kind: "section", lang, folder: path, title: lastSegment(path), entries: list };
}

/** Resolves a help URL (page, folder index page, generated section table of contents) or null. */
export function resolveHelpPath(lang: Lang, raw: string): HelpTarget | null {
  const path = normalizeHelpPath(raw);
  for (const l of langOrder(lang)) {
    const nav = docNav[l];
    if (!nav?.length) continue;
    const hit = resolveIn(nav, l, path);
    if (hit) return hit;
  }
  return null;
}

const humanize = (folder: string) =>
  folder.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export interface NavGroup {
  section: string;
  /** Title of the section's own index page, else the humanised folder name; "" for root pages. */
  title: string;
  /** Section index page (`<folder>/index`), if present. */
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
    if (meta.section && meta.slug === `${meta.section}/index`) {
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
