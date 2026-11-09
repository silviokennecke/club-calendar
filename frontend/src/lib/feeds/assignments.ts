import { isEmailShape } from "@/lib/email";

/** At most this many ids / addresses per request (API limit). */
export const MAX_BATCH = 500;

export interface ParsedEmails {
  /** Valid-looking, lower-cased, de-duplicated addresses in input order. */
  emails: string[];
  /** Entries that do not look like an address. */
  invalid: string[];
  /** More than `MAX_BATCH` valid addresses were pasted. */
  tooMany: boolean;
}

/** Splits pasted text at whitespace, commas and semicolons; strips angle brackets. */
export function parseEmailList(text: string): ParsedEmails {
  const seen = new Set<string>();
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const entry = raw.trim().replace(/^<|>$/g, "").toLowerCase();
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    (isEmailShape(entry) ? emails : invalid).push(entry);
  }
  return { emails, invalid, tooMany: emails.length > MAX_BATCH };
}
