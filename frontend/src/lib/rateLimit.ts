import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api";

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 429 || error.code === "rate_limited");
}

/** Text for a 429, with the wait from `Retry-After` when the server sent it. */
export function rateLimitText(t: TFunction, error: unknown): string {
  const seconds = error instanceof ApiError ? error.retryAfter : undefined;
  if (!seconds) return t("auth.rateLimited");
  return t("auth.rateLimitedWait", { minutes: Math.max(1, Math.ceil(seconds / 60)) });
}

/** Wait from `Retry-After` in whole minutes (at least 1), or undefined when the server sent none. */
export function retryAfterMinutes(error: unknown): number | undefined {
  const seconds = error instanceof ApiError ? error.retryAfter : undefined;
  return seconds ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
}
