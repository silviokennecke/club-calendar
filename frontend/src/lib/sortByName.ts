import i18n from "@/lib/i18n";

const collator = (lang?: string) =>
  new Intl.Collator(lang ?? i18n.resolvedLanguage ?? i18n.language, { sensitivity: "base" });

/** Alphabetical, locale-aware and case-insensitive copy of a list (audience chips and filters). */
export function sortByName<T extends { name: string }>(items: readonly T[], lang?: string): T[] {
  const c = collator(lang);
  return [...items].sort((a, b) => c.compare(a.name, b.name));
}

/** Same for the `{ targetGroup }` wrappers of an event or template. */
export function sortTargetGroupRefs<T extends { targetGroup: { name: string } }>(
  refs: readonly T[],
  lang?: string,
): T[] {
  const c = collator(lang);
  return [...refs].sort((a, b) => c.compare(a.targetGroup.name, b.targetGroup.name));
}
