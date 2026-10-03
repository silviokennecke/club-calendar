// Pure profile logic (no React): date format examples, providers, passkey dates.
import { DATE_FORMAT_OPTIONS, formatDate } from "@/lib/dateFormat";

/** Example date shown for each date format (design: 31.12.2026). */
export const DATE_FORMAT_EXAMPLE_DATE = "2026-12-31";

export function dateFormatChoices() {
  return DATE_FORMAT_OPTIONS.map((o) => ({
    value: o.value,
    example: formatDate(DATE_FORMAT_EXAMPLE_DATE, o.value),
  }));
}

export interface ProviderInfo {
  id: string;
  name: string;
}

export interface ProviderRow extends ProviderInfo {
  linked: boolean;
}

/** "google" -> "Google" (fallback when the provider list has no display name). */
export function providerLabel(id: string): string {
  return id ? id.charAt(0).toUpperCase() + id.slice(1) : id;
}

/**
 * Rows of the "Verknüpfte Anmeldungen" list: every linked account plus the other sign-in providers
 * the server offers (shown as "Nicht verbunden").
 */
export function providerRows(
  linked: ReadonlyArray<{ provider: string }>,
  offered: ReadonlyArray<ProviderInfo>,
): ProviderRow[] {
  const nameOf = (id: string) => offered.find((p) => p.id === id)?.name ?? providerLabel(id);
  const linkedIds = Array.from(new Set(linked.map((a) => a.provider)));
  const rows: ProviderRow[] = linkedIds.map((id) => ({ id, name: nameOf(id), linked: true }));
  for (const p of offered) {
    if (!linkedIds.includes(p.id)) rows.push({ id: p.id, name: p.name, linked: false });
  }
  return rows;
}
