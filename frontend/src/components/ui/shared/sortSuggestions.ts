import type { ChipOption } from "./ChipSelect";

/** Recently used options first (list order), then the rest by id descending (newest for UUID v7). */
export function sortSuggestions(options: ChipOption[], recent: string[] = []): ChipOption[] {
  const rank = new Map(recent.map((id, i) => [id, i]));
  return [...options].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return b.id.localeCompare(a.id);
  });
}
