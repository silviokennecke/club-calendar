import { API_URL } from "./apiUrl";
import { markSessionEnded } from "./sessionEnd";
import type { HolidayCalendar, HolidayEvent, User } from "./types";

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
  /** Extra member `email` of `email_not_verified` (login 403). */
  email?: string;
  constructor(
    message: string,
    status: number,
    code?: string,
    field?: string,
    extras: { retryAt?: string; email?: string } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.field = field;
    this.retryAt = extras.retryAt;
    this.email = extras.email;
  }
}

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
}

/** The session was rejected: forget the tokens and leave for the login page (without unsaved-changes prompt). */
function endSession() {
  clearTokens();
  if (typeof window !== "undefined") {
    markSessionEnded();
    window.location.href = "/login";
  }
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(BASE_URL + path, { ...options, headers });

  if (res.status === 401 && token) {
    // Try token refresh via OAuth2 form-encoded grant
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(BASE_URL + "/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }).toString(),
      });
      if (refreshRes.ok) {
        const data = (await refreshRes.json()) as { access_token: string; refresh_token: string };
        storeTokens(data.access_token, data.refresh_token);
        headers["Authorization"] = `Bearer ${data.access_token}`;
        res = await fetch(BASE_URL + path, { ...options, headers });
      } else {
        endSession();
      }
    } else {
      endSession();
    }
  }

  return res;
}

/** ApiError from a failed response (RFC 7807 body): `detail` as message, plus the stable `code`. */
async function errorFrom(res: Response): Promise<ApiError> {
  const err = (await res.json().catch(() => null)) as {
    detail?: string;
    code?: string;
    field?: string;
    retryAt?: unknown;
    email?: unknown;
  } | null;
  return new ApiError(err?.detail ?? `API error ${res.status}`, res.status, err?.code, err?.field, {
    retryAt: typeof err?.retryAt === "string" ? err.retryAt : undefined,
    email: typeof err?.email === "string" ? err.email : undefined,
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
}

/**
 * Exchanges the one-time `loginToken` (from `POST /api/auth/verify-email`, valid for seconds) for the
 * normal token pair (`grant_type=one_time_token`, form-encoded like the refresh grant). Failure: 400 `invalid_grant`.
 */
export async function exchangeOneTimeToken(token: string): Promise<TokenResponse> {
  const res = await fetch(BASE_URL + "/api/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "one_time_token", token }).toString(),
  });
  if (!res.ok) throw await errorFrom(res);
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw await errorFrom(res);
  return res.json();
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

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) throw await errorFrom(res);
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
  data: { name: string; url: string },
): Promise<HolidayCalendar> {
  return apiPost<HolidayCalendar>(`/api/calendars/${calendarId}/holiday-calendars`, data);
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
