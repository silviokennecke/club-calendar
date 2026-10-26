import type { DocSlug } from "./slugs.generated";

/** Router path of a page slug; `index` and `<folder>/index` map to `/help` and `/help/<folder>`. */
export const docPath = (slug: string, anchor?: string) => {
  const url = slug === "index" ? "" : slug.replace(/\/index$/, "");
  return `/help${url ? `/${url}` : ""}${anchor ? `#${anchor}` : ""}`;
};

/** Path of a help page; a wrong slug is a compile error. */
export function helpPath(page: DocSlug, anchor?: string): string {
  return docPath(page, anchor);
}

export function useHelpUrl(page: DocSlug, anchor?: string): string {
  return helpPath(page, anchor);
}
