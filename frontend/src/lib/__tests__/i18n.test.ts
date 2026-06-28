import { describe, it, expect } from "vitest";
import en from "../../locales/en.json";
import de from "../../locales/de.json";

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
});
