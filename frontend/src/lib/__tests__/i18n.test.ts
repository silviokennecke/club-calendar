import { describe, it, expect } from "vitest";
import en from "../../locales/en.json";
import de from "../../locales/de.json";

function collectEntries(obj: unknown, prefix = ""): [string, unknown][] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [[prefix, obj]];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    collectEntries(v, prefix ? `${prefix}.${k}` : k),
  );
}

function placeholders(text: unknown): string[] {
  return [...String(text).matchAll(/\{\{\s*(\w+)/g)].map((m) => m[1]).sort();
}

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    collectKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe("locale files", () => {
  it("en and de have identical keys", () => {
    const enKeys = collectKeys(en).sort();
    const deKeys = collectKeys(de).sort();
    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const extraInDe = deKeys.filter((k) => !enKeys.includes(k));
    expect(missingInDe, "Keys in en but not in de").toEqual([]);
    expect(extraInDe, "Keys in de but not in en").toEqual([]);
  });

  it("every text is a non-empty string with the same placeholders in de and en", () => {
    const enTexts = new Map(collectEntries(en));
    const problems = collectEntries(de).flatMap(([key, deText]) => {
      const enText = enTexts.get(key);
      if (typeof deText !== "string" || deText.trim() === "") return [`de ${key}: not a text`];
      if (typeof enText !== "string" || enText.trim() === "") return [`en ${key}: not a text`];
      const a = placeholders(deText).join(",");
      const b = placeholders(enText).join(",");
      return a === b ? [] : [`${key}: de {{${a}}} vs en {{${b}}}`];
    });
    expect(problems).toEqual([]);
  });
});
