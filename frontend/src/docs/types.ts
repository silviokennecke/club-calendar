export type Lang = "de" | "en";
export const DOC_LANGS: readonly Lang[] = ["de", "en"];

export interface DocMeta {
  slug: string;
  title: string;
  /** First path segment of the slug; "" for root pages. */
  section: string;
  order: number;
  description?: string;
}

export type DocPropValue = string | number | boolean;

export type DocNode =
  | { type: "text"; value: string }
  | { type: "element"; tag: string; props: Record<string, DocPropValue>; children: DocNode[] };

export interface DocTocEntry {
  depth: number;
  id: string;
  text: string;
}

export interface DocPage {
  meta: DocMeta;
  toc: DocTocEntry[];
  tree: DocNode;
}
