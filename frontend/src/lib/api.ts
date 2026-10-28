import i18n from "i18next";
import { toast } from "sonner";
import { API_URL } from "./apiUrl";
import { clearInvitationToken } from "./invitations";
import { markSessionEnded } from "./sessionEnd";
import type {
  HolidayCalendar,
  HolidayCountry,
  HolidayEvent,
  HolidaySubdivision,
  HolidayType,
  User,
} from "./types";

const BASE_URL = API_URL;

export const BACKEND_URL = BASE_URL;

/** Failed API call; `status` is the HTTP status (react-query uses it to decide about retries). */
export class ApiError extends Error {
  status: number;
  /** Stable error code of the RFC 7807 body, e.g. "duplicate_name" (only some errors carry one). */
  code?: string;
  /** Input the error refers to (`field` of the RFC 7807 body, e.g. "url"), if any. */
  field?: string;
  /** Extra member `retryAt` (ISO-8601 UTC) of `verification_resend_too_early`. */
  retryAt?: string;
  /** Extra member `email` of `email_verification_required` (403 of the verify gate). */
  email?: string;
  /** `Retry-After` header in seconds (429 answers), if present. */
  retryAfter?: number;
  constructor(
    message: string,
    status: number,
    code?: string,
    field?: string,
    extras: { retryAt?: string; email?: string; retryAfter?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAt = extras.retryAt;
    this.email = extras.email;
    this.retryAfter = extras.retryAfter;
  }
}

/** Fired on a 403 `consent_required`: the AuthProvider reloads the user so the consent gate appears. */
export const CONSENT_REQUIRED_EVENT = "cc:consent-required";
/** Fired on a 403 `email_verification_required`: the session is restricted until the address is confirmed. */
export const EMAIL_VERIFICATION_REQUIRED_EVENT = "cc:email-verification-required";

/** Whether a request failed because the name already exists in the calendar (422 duplicate_name). */
export function isDuplicateNameError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422 && error.code === "duplicate_name";
}

let accessToken: string | null = null;

export function storeTokens(newAccessToken: string, newRefreshToken: string) {
  accessToken = newAccessToken;
  if (typeof window !== "undefined") {
    sessionStorage.setItem("access_token", newAccessToken);
    sessionStorage.setItem("refresh_token", newRefreshToken);
  }
}

export function getAccessToken(): string | null {
  if (accessToken) return accessToken;
  if (typeof window !== "undefined") {
    // Support both new key and old key for backward compatibility
    return sessionStorage.getItem("access_token") ?? sessionStorage.getItem("accessToken");
  }
  return null;
}

function getRefreshToken(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem("refresh_token");
  }
  return null;
}

export function clearTokens() {
  accessToken = null;
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("access_token");
    sessionStorage.removeItem("refresh_token");
    // Also remove old key in case it exists
    sessionStorage.removeItem("accessToken");
  }
  // A pending invitation belongs to the visitor who opened the link, not to whoever signs in next.
  clearInvitationToken();
}

/** The session was rejected: forget the tokens and leave for the login page (without unsaved-changes prompt). */
function endSession() {
  clearTokens();
  if (typeof window !== "undefined") {
    markSessionEnded();
    window.location.href = "/login";
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const LONG_REQUEST_TIMEOUT_MS = 120_000;
/** Import, import preview and ICS/PDF export can legitimately take longer. */
const LONG_REQUEST_PATH = /\/events\/import(\/preview)?(\?|$)|\/events\.(ics|pdf)(\?|$)/;

/**
 * fetch with a timeout. A timeout rejects with ApiError `request_timeout` (status 0, like a network error:
 * no verdict from the server); the caller's own `signal` still aborts with a plain AbortError.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const caller = init.signal;
  const onCallerAbort = () => controller.abort(caller?.reason);
  if (caller?.aborted) onCallerAbort();
  else caller?.addEventListener("abort", onCallerAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut && !caller?.aborted) {
      throw new ApiError(i18n.t("common.requestTimeout"), 0, "request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}

/** Refresh request in flight: concurrent 401s share it (the refresh token is single-use, see `refreshSession`). */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchanges the refresh token for a new pair (`grant_type=refresh_token`). The backend rotates the token:
 * each one works once, so two parallel refreshes would use the same token twice (and a replay outside the
 * short grace window ends the whole session). Hence ONE request at a time: every caller waits for it and
 * continues with the new tokens. Resolves to the new access token; null when the session cannot continue
 * (the server rejected it: the session ends, or the answer was no verdict such as 429 / 5xx: nothing changes).
 * A network error rejects (no verdict about the session either).
 */
export function refreshSession(): Promise<string | null> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    endSession();
    return null;
  }
  const res = await fetchWithTimeout(
    BASE_URL + "/api/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    },
    REQUEST_TIMEOUT_MS,
  );
  if (res.ok) {
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    storeTokens(data.access_token, data.refresh_token);
    return data.access_token;
  }
  // Only the server's verdict on the token ends the session; rate limits and outages do not.
  if (res.status === 400 || res.status === 401 || res.status === 403) endSession();
  return null;
}

/**
 * Ends the server side of this browser's session (`POST /api/auth/logout` revokes the refresh token's
 * family). Fire and forget: the local sign-out never waits for, or fails because of, the network. Call it
 * before `clearTokens()`. Sent without the access token (an expired one would be answered with 401).
 */
export function revokeRefreshToken(): void {
  const refreshToken = getRefreshToken();
  if (!refreshToken || typeof fetch === "undefined") return;
  try {
    void fetch(BASE_URL + "/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // never block the local sign-out
  }
}

/** Ends all sessions of the account (`POST /api/auth/logout-all`); the caller then signs out locally. */
export async function logoutEverywhere(): Promise<void> {
  const res = await apiFetch("/api/auth/logout-all", { method: "POST", body: "{}" });
  if (!res.ok) throw await errorFrom(res);
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const timeoutMs = LONG_REQUEST_PATH.test(path) ? LONG_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  let res = await fetchWithTimeout(BASE_URL + path, { ...options, headers }, timeoutMs);

  if (res.status === 401 && token) {
    // Another request may have refreshed while this one was in flight: then just retry with the current token.
    const current = getAccessToken();
    const fresh = current && current !== token ? current : await refreshSession();
    if (fresh) {
      headers["Authorization"] = `Bearer ${fresh}`;
      res = await fetchWithTimeout(BASE_URL + path, { ...options, headers }, timeoutMs);
    }
  }

  return res;
}

function retryAfterOf(res: Response): number | undefined {
  const seconds = Number(res.headers?.get?.("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** ApiError from a failed response (RFC 7807 body): `detail` as message, plus the stable `code`. */
export async function errorFrom(res: Response): Promise<ApiError> {
  const err = (await res.json().catch(() => null)) as {
    detail?: string;
    code?: string;
    field?: string;
    retryAt?: unknown;
    email?: unknown;
  } | null;
  // Quota of a club/calendar used up (422): one clear message for every create form and import
  if (err?.code === "quota_exceeded") toast.error(i18n.t("common.quotaExceeded"));
  if (res.status === 403 && err?.code === "consent_required" && typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONSENT_REQUIRED_EVENT));
  }
  if (
    res.status === 403 &&
    err?.code === "email_verification_required" &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event(EMAIL_VERIFICATION_REQUIRED_EVENT));
  }
  return new ApiError(err?.detail ?? `API error ${res.status}`, res.status, err?.code, err?.field, {
    retryAt: typeof err?.retryAt === "string" ? err.retryAt : undefined,
    email: typeof err?.email === "string" ? err.email : undefined,
    retryAfter: retryAfterOf(res),
  });
}

/** Body of a successful response; 204 No Content resolves to `undefined`. */
async function bodyOf<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Token response of login and of the `/api/auth/token` grants. */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: User;
  /** True for a restricted session: the e-mail address still has to be confirmed. */
  emailVerificationRequired?: boolean;
}

/** The signed-in user of a token response, with the top-level verification flag merged in. */
export function sessionUser(tokens: { user: User; emailVerificationRequired?: boolean }): User {
  return tokens.emailVerificationRequired
    ? { ...tokens.user, emailVerificationRequired: true }
    : tokens.user;
}

/**
 * Confirms the address of the signed-in (restricted) session with the mailed code. The answer is a new
 * token pair in a new session family: the old tokens are dead, the caller must store the new ones.
 * Wrong, expired or used up code: 422 `invalid_verification_code`.
 */
export async function verifyEmail(code: string): Promise<TokenResponse> {
  return apiPost<TokenResponse>("/api/auth/verify-email", { code });
}

/** Mails a new confirmation code to the signed-in user (204; 429 `verification_resend_too_early` / `rate_limited`). */
export async function resendVerification(): Promise<void> {
  await apiPost("/api/auth/resend-verification", undefined);
}

/**
 * Exchanges a one-time code (SSO redirect `?code=`) for the normal token pair
 * (`grant_type=one_time_token`, form-encoded like the refresh grant). Failure: 400 `invalid_grant`.
 */
export async function exchangeOneTimeToken(token: string): Promise<TokenResponse> {
  const res = await fetchWithTimeout(
    BASE_URL + "/api/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "one_time_token", token }).toString(),
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

/** GET that also returns the `X-Total-Count` header (null when absent). */
export async function apiGetWithTotal<T>(
  path: string,
  signal?: AbortSignal,
): Promise<{ data: T; total: number | null }> {
  const res = await apiFetch(path, { signal });
  if (!res.ok) throw await errorFrom(res);
  const header = res.headers.get("X-Total-Count");
  const total = header === null ? NaN : Number(header);
  return { data: await res.json(), total: Number.isFinite(total) ? total : null };
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await errorFrom(res);
  return bodyOf<T>(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, { method: "PATCH", body: JSON.stringify(body) });
  if (!res.ok) throw await errorFrom(res);
  return bodyOf<T>(res);
}

/** The body of the answer is only of interest to deletes that return something (a passkey: new tokens). */
export async function apiDelete<T = void>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(
    path,
    body === undefined
      ? { method: "DELETE" }
      : {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!res.ok) throw await errorFrom(res);
  return bodyOf<T>(res);
}

/**
 * HTTP status of a failed API call (`ApiError.status`), or undefined (network error). The message of an
 * ApiError is the server's text, not the status: recognise 403 / 404 by this, never by the message.
 */
export function apiErrorStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { status?: unknown }).status === "number"
  )
    return (error as { status: number }).status;
  return undefined;
}

/** The stable error code of a failed API call (`ApiError.code`), or undefined (network error, no code). */
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined;
}

export function getHolidayCalendars(calendarId: string): Promise<HolidayCalendar[]> {
  return apiGet<HolidayCalendar[]>(`/api/calendars/${calendarId}/holiday-calendars`);
}

export function createHolidayCalendar(
  calendarId: string,
  data: { name: string; url: string; type?: HolidayType },
): Promise<HolidayCalendar> {
  return apiPost<HolidayCalendar>(`/api/calendars/${calendarId}/holiday-calendars`, data);
}

export function getHolidayCountries(): Promise<HolidayCountry[]> {
  return apiGet<HolidayCountry[]>("/api/holiday-sources/countries");
}

export function getHolidaySubdivisions(iso: string): Promise<HolidaySubdivision[]> {
  return apiGet<HolidaySubdivision[]>(`/api/holiday-sources/countries/${iso}/subdivisions`);
}

export function createPredefinedHolidayCalendars(
  calendarId: string,
  data: {
    country: string;
    subdivision?: string;
    kinds: ("public" | "school")[];
    regionName?: string;
  },
): Promise<HolidayCalendar[]> {
  return apiPost<HolidayCalendar[]>(
    `/api/calendars/${calendarId}/holiday-calendars/predefined`,
    data,
  );
}

export function deleteHolidayCalendar(calendarId: string, id: string): Promise<void> {
  return apiDelete(`/api/calendars/${calendarId}/holiday-calendars/${id}`);
}

export function refreshHolidayCalendar(calendarId: string, id: string): Promise<HolidayCalendar> {
  return apiPost<HolidayCalendar>(
    `/api/calendars/${calendarId}/holiday-calendars/${id}/refresh`,
    {},
  );
}

export function getHolidayEvents(
  calendarId: string,
  from: string,
  to: string,
): Promise<HolidayEvent[]> {
  return apiGet<HolidayEvent[]>(
    `/api/calendars/${calendarId}/holiday-events?from=${from}&to=${to}`,
  );
}
