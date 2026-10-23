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
