import { apiFetch, errorFrom } from "@/lib/api";

export const DEFAULT_EXPORT_FILENAME = "club-calendar-export.json";

/** The export is a stream: a cut-off file is not valid JSON. Checks the ends instead of parsing it all. */
export async function looksComplete(blob: Blob): Promise<boolean> {
  if (blob.size < 2) return false;
  const head = (await blob.slice(0, 16).text()).trimStart();
  const tail = (await blob.slice(Math.max(0, blob.size - 64)).text()).trimEnd();
  return head.startsWith("{") && tail.endsWith("}");
}

export function exportFilename(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  const name = match?.[1]?.trim();
  return name && /^[\w.-]+$/.test(name) ? name : DEFAULT_EXPORT_FILENAME;
}

/** Requests the personal data export (step-up handled by `apiFetch`); rejects when the file is incomplete. */
export async function fetchDataExport(): Promise<{ blob: Blob; filename: string }> {
  const res = await apiFetch("/api/auth/me/export", { method: "POST" });
  if (!res.ok) throw await errorFrom(res);
  const filename = exportFilename(res.headers.get("Content-Disposition"));
  const blob = await res.blob();
  if (!(await looksComplete(blob))) throw new Error("incomplete_export");
  return { blob, filename };
}
