import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import { toString as hastToString } from "hast-util-to-string";
import MiniSearch from "minisearch";
import { format, resolveConfig } from "prettier";
import type { Element, Root as HastRoot, RootContent as HastContent } from "hast";
import type { Blockquote, Root as MdRoot, RootContent as MdContent } from "mdast";
import { visit } from "unist-util-visit";
import { DOC_SEARCH_OPTIONS } from "../src/docs/searchConfig";
import type { DocMeta, DocNode, DocPage, DocPropValue, Lang } from "../src/docs/types";

export const SHOT_PREFIX = "shot-asset:";
const LANGS: Lang[] = ["de", "en"];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;
const CALLOUTS = new Set(["note", "tip", "warning"]);

export interface CompiledPage extends DocPage {
  /** Absolute screenshot files; `src: "shot-asset:<i>"` in the tree points at index i. */
  shots: string[];
  files: string[];
}

export interface CompiledDocs {
  pages: Record<Lang, Record<string, CompiledPage>>;
  nav: Record<Lang, DocMeta[]>;
  slugs: string[];
  searchIndex: Record<Lang, string>;
  files: string[];
}

interface Source {
  file: string;
  rel: string;
  slug: string;
  meta: DocMeta;
  body: string;
  /** Numeric folder prefix of the section (`10-name`), null without prefix; -1 for root pages. */
  rank: number | null;
}

const fail = (file: string, msg: string): never => {
  throw new Error(`[docs] ${file}: ${msg}`);
};

function listMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listMarkdown(p) : e.name.endsWith(".md") ? [p] : [];
  });
}

function readSources(root: string, lang: Lang): Source[] {
  const langDir = path.join(root, lang);
  const sources = listMarkdown(langDir)
    .sort()
    .map((file) => {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const parts = path
        .relative(langDir, file)
        .split(path.sep)
        .join("/")
        .replace(/\.md$/, "")
        .split("/");
      let rank: number | null = parts.length > 1 ? null : -1;
      if (parts.length > 1) {
        const pre = /^(\d{2})-(.+)$/.exec(parts[0]);
        if (pre) {
          rank = Number(pre[1]);
          parts[0] = pre[2];
        }
      }
      const slug = parts.join("/");
      if (!SLUG_RE.test(slug))
        fail(rel, `invalid slug "${slug}" (lower-case a-z, 0-9, "-" and "/")`);
      const { data, content } = matter(fs.readFileSync(file, "utf8"));
      if (typeof data.title !== "string" || data.title.trim() === "")
        fail(rel, "missing frontmatter title");
      if (data.order !== undefined && typeof data.order !== "number")
        fail(rel, "order must be a number");
      if (data.description !== undefined && typeof data.description !== "string")
        fail(rel, "description must be a string");
      const meta: DocMeta = {
        slug,
        title: data.title.trim(),
        section: slug.includes("/") ? slug.split("/")[0] : "",
        order: data.order ?? 100,
        ...(data.description ? { description: data.description } : {}),
      };
      return { file, rel, slug, meta, body: content, rank };
    });
  const seen = new Map<string, string>();
  const prefixes = new Map<number, string>();
  for (const src of sources) {
    const prev = seen.get(src.slug);
    if (prev) fail(src.rel, `duplicate slug "${src.slug}" (also ${prev})`);
    seen.set(src.slug, src.rel);
    if (src.rank !== null && src.rank >= 0) {
      const other = prefixes.get(src.rank);
      if (other !== undefined && other !== src.meta.section)
        fail(
          src.rel,
          `duplicate section prefix ${src.rank} ("${other}" and "${src.meta.section}")`,
        );
      prefixes.set(src.rank, src.meta.section);
    }
  }
  return sources;
}

// Callouts and tabs are cut out of the source line-wise (fenced code is skipped) and parsed on their
// own; a dedicated micro-syntax avoids remark-directive eating text like "10:30".
//   :::note|tip|warning            ... :::
//   :::tabs [key=<param>] [platform]
//   :::tab <id> <label>            ... :::      (repeat; only whitespace between tabs)
//   :::                                         (closes the group)
// Nothing nests: callouts and tab groups are not allowed inside a tab or each other.
interface TabSrc {
  id: string;
  label: string;
  text: string;
}
interface TabsSrc {
  key: string;
  platform: boolean;
  tabs: TabSrc[];
}
type Segment = { callout?: string; tabs?: TabsSrc; text: string };

function parseTabsAttrs(rel: string, rest: string): Omit<TabsSrc, "tabs"> {
  const out = { key: "tab", platform: false };
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    const kv = /^key=([a-z][\w-]*)$/i.exec(tok);
    if (kv) out.key = kv[1];
    else if (tok === "platform") out.platform = true;
    else fail(rel, `unknown attribute "${tok}" on ":::tabs" (key=<name>, platform)`);
  }
  return out;
}

function splitSegments(rel: string, body: string): Segment[] {
  const segments: Segment[] = [];
  let cur: Segment = { text: "" };
  let group: TabsSrc | null = null;
  let tab: TabSrc | null = null;
  let fence: string | null = null;
  const push = () => {
    if (cur.callout || cur.text.trim()) segments.push(cur);
  };
  for (const line of body.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
    }
    const open = fence === null ? /^:::(\w+)(?:[ \t]+(.*?))?\s*$/.exec(line) : null;
    if (open) {
      const [, name, rest = ""] = open;
      if (name === "tabs") {
        if (group || cur.callout) fail(rel, "tab groups cannot be nested");
        push();
        group = { ...parseTabsAttrs(rel, rest), tabs: [] };
      } else if (name === "tab") {
        if (!group) fail(rel, '":::tab" outside of a ":::tabs" group');
        if (tab) fail(rel, 'tabs cannot be nested (close ":::tab" with ":::" first)');
        const m = /^([\w-]+)\s+(\S.*)$/.exec(rest);
        if (!m) fail(rel, 'tab needs an id and a label: ":::tab <id> <label>"');
        if (group!.tabs.some((t) => t.id === m![1]))
          fail(rel, `duplicate tab id "${m![1]}" in ":::tabs"`);
        tab = { id: m![1], label: m![2], text: "" };
      } else {
        if (group || cur.callout) fail(rel, "callouts cannot be nested or used inside tabs");
        if (!CALLOUTS.has(name)) fail(rel, `unknown callout ":::${name}" (note, tip, warning)`);
        push();
        cur = { callout: name, text: "" };
      }
    } else if (fence === null && /^:::\s*$/.test(line)) {
      if (tab) {
        group!.tabs.push(tab);
        tab = null;
      } else if (group) {
        if (group.tabs.length === 0) fail(rel, 'empty ":::tabs" group');
        segments.push({ tabs: group, text: "" });
        group = null;
        cur = { text: "" };
      } else if (cur.callout) {
        push();
        cur = { text: "" };
      } else fail(rel, 'closing ":::" without an opening callout or tab group');
    } else if (tab) {
      tab.text += line + "\n";
    } else if (group) {
      if (line.trim()) fail(rel, 'content between tabs: put it inside a ":::tab" block');
    } else {
      cur.text += line + "\n";
    }
  }
  if (tab) fail(rel, `tab ":::tab ${tab.id}" is not closed`);
  if (group) fail(rel, '":::tabs" group is not closed');
  if (cur.callout) fail(rel, `callout ":::${cur.callout}" is not closed`);
  push();
  return segments;
}

const mdProcessor = unified().use(remarkParse).use(remarkGfm);
// No allowDangerousHtml: raw HTML nodes are dropped.
const toHast = unified().use(remarkRehype).use(rehypeSlug);

function plainChildren(node: HastRoot | Element): string[] {
  return node.children.map((c) => hastToString(c as never)).filter((t) => t.trim());
}

function convert(node: HastContent, out: DocNode[]): void {
  if (node.type === "text") {
    if (node.value.trim() === "" && node.value.includes("\n")) return;
    out.push({ type: "text", value: node.value });
  } else if (node.type === "element") {
    const props: Record<string, DocPropValue> = {};
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      if (v === undefined || v === null || v === false) continue;
      props[k] = Array.isArray(v) ? v.join(" ") : (v as DocPropValue);
    }
    if (props["data-help"] !== undefined) delete props.href;
    const children: DocNode[] = [];
    node.children.forEach((c) => convert(c, children));
    out.push({ type: "element", tag: node.tagName, props, children });
  }
}

async function compilePage(
  src: Source,
  lang: Lang,
  root: string,
  slugs: Set<string>,
): Promise<{ page: CompiledPage; hast: HastRoot }> {
  const shots: string[] = [];
  const children: MdContent[] = [];

  const tabKeys = new Set<string>();
  for (const seg of splitSegments(src.rel, src.body)) {
    if (seg.tabs) {
      if (tabKeys.has(seg.tabs.key))
        fail(src.rel, `duplicate tabs key "${seg.tabs.key}" (use key=<name> to tell groups apart)`);
      tabKeys.add(seg.tabs.key);
      const panels: Blockquote[] = seg.tabs.tabs.map((t) => ({
        type: "blockquote",
        children: (mdProcessor.parse(t.text) as MdRoot).children as Blockquote["children"],
        data: { hName: "div", hProperties: { "data-tab": t.id, "data-label": t.label } },
      }));
      children.push({
        type: "blockquote",
        children: panels,
        data: {
          hName: "div",
          hProperties: {
            "data-tabs": seg.tabs.key,
            ...(seg.tabs.platform ? { "data-platform": true } : {}),
          },
        },
      });
      continue;
    }
    const parsed = mdProcessor.parse(seg.text) as MdRoot;
    if (seg.callout) {
      const box: Blockquote = {
        type: "blockquote",
        children: parsed.children as Blockquote["children"],
        data: { hName: "div", hProperties: { "data-callout": seg.callout } },
      };
      children.push(box);
    } else {
      children.push(...parsed.children);
    }
  }
  const mdast: MdRoot = { type: "root", children };

  visit(mdast, (node) => {
    if (node.type === "image" && node.url.startsWith("shot:")) {
      const id = node.url.slice(5);
      const file = path.join(root, "screenshots", lang, `${id}.png`);
      if (!/^[\w-]+$/.test(id) || !fs.existsSync(file))
        fail(src.rel, `screenshot "${id}" not found (expected screenshots/${lang}/${id}.png)`);
      node.url = SHOT_PREFIX + shots.length;
      shots.push(file);
    } else if (node.type === "link") {
      if (node.url.startsWith("help:")) {
        const target = node.url.slice(5);
        const slug = target.split("#")[0];
        if (!slugs.has(slug))
          fail(src.rel, `link help:${target} points to an unknown page "${slug}"`);
        node.data = { ...node.data, hProperties: { "data-help": target } };
      } else if (/^https?:\/\//i.test(node.url)) {
        node.data = {
          ...node.data,
          hProperties: { target: "_blank", rel: ["noopener", "noreferrer"] },
        };
      }
    }
  });

  const hast = (await toHast.run(mdast)) as HastRoot;
  const toc: DocPage["toc"] = [];
  for (const n of hast.children) {
    if (n.type === "element" && /^h[2-3]$/.test(n.tagName) && typeof n.properties?.id === "string")
      toc.push({ depth: Number(n.tagName[1]), id: n.properties.id, text: hastToString(n) });
  }
  const treeChildren: DocNode[] = [];
  hast.children.forEach((c) => convert(c, treeChildren));
  const tree: DocNode = { type: "element", tag: "div", props: {}, children: treeChildren };

  return { page: { meta: src.meta, toc, tree, shots, files: [src.file, ...shots] }, hast };
}

function buildSearch(pages: CompiledPage[], hastByPage: Map<string, HastRoot>): string {
  const ms = new MiniSearch(DOC_SEARCH_OPTIONS);
  for (const p of pages) {
    const hast = hastByPage.get(p.meta.slug)!;
    const { slug, title, section } = p.meta;
    const entries: { id: string; heading: string; anchor: string; text: string[] }[] = [];
    let current: (typeof entries)[number] | null = null;
    for (const n of hast.children) {
      if (
        n.type === "element" &&
        /^h[2-3]$/.test(n.tagName) &&
        typeof n.properties?.id === "string"
      ) {
        current = {
          id: `${slug}#${n.properties.id}`,
          heading: hastToString(n),
          anchor: n.properties.id,
          text: [],
        };
        entries.push(current);
      } else if (current && n.type === "element") {
        current.text.push(
          ...plainChildren({ type: "element", tagName: "x", properties: {}, children: [n] }),
        );
      }
    }
    ms.add({
      id: slug,
      slug,
      title,
      section,
      anchor: "",
      heading: "",
      text: [p.toc.map((t) => t.text).join(" "), hastToString(hast as never)].join(" "),
    });
    for (const e of entries)
      ms.add({
        id: e.id,
        slug,
        title,
        section,
        anchor: e.anchor,
        heading: e.heading,
        text: e.text.join(" "),
      });
  }
  return JSON.stringify(ms);
}

/** Root pages first, then sections by folder prefix (unprefixed last, alphabetical), pages by order, title. */
function sortSources(list: Source[]): Source[] {
  const rank = (s: Source) => s.rank ?? Infinity;
  return [...list].sort(
    (a, b) =>
      (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) ||
      a.meta.section.localeCompare(b.meta.section) ||
      a.meta.order - b.meta.order ||
      a.meta.title.localeCompare(b.meta.title),
  );
}

export async function compileDocs(root: string): Promise<CompiledDocs> {
  const sources = Object.fromEntries(LANGS.map((l) => [l, readSources(root, l)])) as Record<
    Lang,
    Source[]
  >;
  const slugSets = Object.fromEntries(
    LANGS.map((l) => [l, new Set(sources[l].map((s) => s.slug))]),
  ) as Record<Lang, Set<string>>;

  const missing: string[] = [];
  for (const l of LANGS) {
    const other = LANGS.find((x) => x !== l)!;
    for (const s of slugSets[l])
      if (!slugSets[other].has(s)) missing.push(`${s} (exists in ${l}, missing in ${other})`);
  }
  if (missing.length)
    throw new Error(`[docs] pages missing in one language:\n  ${missing.sort().join("\n  ")}`);

  const pages = { de: {}, en: {} } as CompiledDocs["pages"];
  const nav = { de: [], en: [] } as unknown as CompiledDocs["nav"];
  const searchIndex = {} as Record<Lang, string>;
  const files = new Set<string>();

  for (const lang of LANGS) {
    const hasts = new Map<string, HastRoot>();
    for (const src of sources[lang]) {
      const { page, hast } = await compilePage(src, lang, root, slugSets[lang]);
      pages[lang][src.slug] = page;
      page.files.forEach((f) => files.add(f));
      hasts.set(src.slug, hast);
    }
    nav[lang] = sortSources(sources[lang]).map((x) => x.meta);
    searchIndex[lang] = buildSearch(Object.values(pages[lang]), hasts);
  }

  return { pages, nav, slugs: [...slugSets.de].sort(), searchIndex, files: [...files] };
}

export async function renderSlugsFile(slugs: string[], filePath: string): Promise<string> {
  const src = [
    "// Generated by vite/docs-plugin.ts from frontend/docs/. Do not edit.",
    `export const DOC_SLUGS = [${slugs.map((s) => JSON.stringify(s)).join(", ")}] as const;`,
    "",
    "export type DocSlug = (typeof DOC_SLUGS)[number];",
    "",
  ].join("\n");
  const config = (await resolveConfig(filePath)) ?? {};
  return format(src, { ...config, filepath: filePath });
}
