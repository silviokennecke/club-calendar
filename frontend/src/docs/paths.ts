import type { DocSlug } from "./slugs.generated";

export const docPath = (slug: string, anchor?: string) =>
  `${slug === "index" ? "/help" : `/help/${slug}`}${anchor ? `#${anchor}` : ""}`;

/** Path of a help page; a wrong slug is a compile error. */
export function helpPath(page: DocSlug, anchor?: string): string {
  return docPath(page, anchor);
}

export function useHelpUrl(page: DocSlug, anchor?: string): string {
  return helpPath(page, anchor);
}
