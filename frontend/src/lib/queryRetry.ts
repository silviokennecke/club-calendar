/** Failed requests are retried at most this often (server errors, network failures). */
export const MAX_RETRIES = 2;

/**
 * react-query `retry` rule: 4xx answers (401, 403, 404, ...) will not change on a retry, so they fail at
 * once and the error state shows immediately instead of after the back-off (~7 s). Server errors (5xx)
 * and network failures (no status) are retried up to `MAX_RETRIES` times.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  return failureCount < MAX_RETRIES;
}
