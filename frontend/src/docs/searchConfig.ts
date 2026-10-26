import type { Options } from "minisearch";

// Shared by the build-time index writer and the runtime MiniSearch.loadJSON call.
export const DOC_SEARCH_OPTIONS: Options = {
  fields: ["title", "heading", "text"],
  storeFields: ["slug", "title", "section", "anchor", "heading"],
  idField: "id",
};

export interface DocSearchHit {
  id: string;
  slug: string;
  title: string;
  section: string;
  /** Heading id for deep links, "" for whole-page entries. */
  anchor: string;
  heading: string;
}
