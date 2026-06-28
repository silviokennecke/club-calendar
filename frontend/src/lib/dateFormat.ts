const FORMATS: Record<string, string> = {
  "dd.MM.yyyy": "de-DE", // 12.06.2026
  "MM/dd/yyyy": "en-US", // 06/12/2026
  "yyyy-MM-dd": "sv-SE", // 2026-06-12  (ISO-like)
  "dd/MM/yyyy": "en-GB", // 12/06/2026
};

// Suppress unused variable warning
void FORMATS;

export function formatDate(dateStr: string, format: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  if (!year || !month || !day) return dateStr;
  return format
    .replace("yyyy", year)
    .replace("MM", month.padStart(2, "0"))
    .replace("dd", day.padStart(2, "0"));
}

export const DATE_FORMAT_OPTIONS = [
  { value: "dd.MM.yyyy", label: "31.12.2026 (DD.MM.YYYY)" },
  { value: "dd/MM/yyyy", label: "31/12/2026 (DD/MM/YYYY)" },
  { value: "MM/dd/yyyy", label: "12/31/2026 (MM/DD/YYYY)" },
  { value: "yyyy-MM-dd", label: "2026-12-31 (YYYY-MM-DD)" },
];
