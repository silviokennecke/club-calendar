import Fuse from "fuse.js";

/** Lower-cases and strips diacritics so "Müller" and "muller" compare equal. */
function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** 0 = a field starts with the query, 1 = contains it, 2 = loose fuzzy match only. */
function matchTier(values: string[], query: string): number {
  if (values.some((v) => v.startsWith(query))) return 0;
  if (values.some((v) => v.includes(query))) return 1;
  return 2;
}

/**
 * Returns the items that match `query` in one of `keys`, best match first.
 * Prefix matches rank above substring matches, which rank above loose fuzzy
 * matches (typos); within a tier the Fuse score decides, ties keep input order.
 */
export function rankByRelevance<T extends object>(
  items: readonly T[],
  query: string,
  keys: readonly (keyof T)[],
): T[] {
  const q = normalize(query.trim());
  if (!q || keys.length === 0) return [];
  const fuse = new Fuse([...items], {
    keys: keys as unknown as string[],
    includeScore: true,
    ignoreLocation: true,
    ignoreDiacritics: true,
    threshold: 0.35,
  });
  return fuse
    .search(q)
    .map((hit, index) => ({
      item: hit.item,
      score: hit.score ?? 1,
      index,
      tier: matchTier(
        keys.map((k) => normalize(hit.item[k])),
        q,
      ),
    }))
    .sort((a, b) => a.tier - b.tier || a.score - b.score || a.index - b.index)
    .map((r) => r.item);
}
