// Pure profile logic (no React): date format examples, providers, passkey dates.
import { DATE_FORMAT_OPTIONS, formatDate } from "@/lib/dateFormat";

/** Example date shown for each date format (design: 31.12.2026). */
const DATE_FORMAT_EXAMPLE_DATE = "2026-12-31";

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

/** What the "last sign-in method" check needs from `GET /api/auth/me`. */
export interface SignInMethods {
  hasPassword: boolean;
  passkeys: ReadonlyArray<unknown>;
  oauthAccounts: ReadonlyArray<{ provider: string }>;
}

/**
 * Whether unlinking `provider` would leave the account without a way to sign in (no password, no
 * passkey, no other provider). The backend refuses it as well (409 `last_login_method`).
 */
export function isLastSignInMethod(methods: SignInMethods, provider: string): boolean {
  if (methods.hasPassword || methods.passkeys.length > 0) return false;
  return !methods.oauthAccounts.some((a) => a.provider !== provider);
}

/** Error codes of the SSO link flow (`/profile?link_error=`) with an own text; others are "generic". */
const LINK_ERRORS = [
  "account_in_use",
  "already_linked",
  "provider_denied",
  "provider_error",
  "oauth_failed",
  "invalid_state",
] as const;

export type LinkError = (typeof LINK_ERRORS)[number] | "generic";

export function linkErrorKind(code: string | null | undefined): LinkError {
  return (LINK_ERRORS as readonly string[]).includes(code ?? "") ? (code as LinkError) : "generic";
}

/** Day of an ISO timestamp (e.g. a UTC `lastUsedAt`) in the browser's time zone, as YYYY-MM-DD. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
