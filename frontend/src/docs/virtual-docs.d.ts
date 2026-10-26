declare module "virtual:docs" {
  import type { DocMeta, DocPage, Lang } from "@/docs/types";

  export const docNav: Record<Lang, DocMeta[]>;
  export function loadDocPage(lang: Lang, slug: string): Promise<DocPage>;
  /** Serialized MiniSearch index; restore with MiniSearch.loadJSON(json, DOC_SEARCH_OPTIONS). */
  export function loadSearchIndex(lang: Lang): Promise<string>;
}
