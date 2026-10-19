import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrast of the design tokens in `src/index.css` (WCAG 2.2: 1.4.3 text 4.5:1, 1.4.11 non-text 3:1),
 * calculated from the token values for both themes. Covers what axe cannot see in jsdom: audience tags
 * in selected table rows and the skeleton placeholders.
 */
const css = readFileSync(path.resolve(__dirname, "../../index.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

const light = tokens(':root,\n[data-theme="light"]');
const dark = { ...light, ...tokens('[data-theme="dark"] {') };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = { light, dark } as const;

describe.each(Object.entries(themes))("contrast tokens (%s)", (_name, t) => {
  it("audience tag text is readable (4.5:1) on every tag background", () => {
    for (const bg of [
      "tag-youth-bg",
      "tag-adult-bg",
      "tag-senior-bg",
      "brand-soft",
      "surface-sunken",
    ]) {
      expect(contrast(t.ink, t[bg]), bg).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the tag outline stands out (3:1) from every row background, also the selected one", () => {
    for (const row of ["surface", "surface-raised", "brand-soft", "surface-sunken"]) {
      expect(contrast(t["border-strong"], t[row]), `outline on ${row}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the skeleton outline stands out (3:1) from every surface it is placed on", () => {
    for (const bg of ["surface", "surface-raised", "surface-sunken"]) {
      expect(contrast(t["border-strong"], t[bg]), `outline on ${bg}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("the skeleton has a fill for both pulse states (the outline carries the contrast)", () => {
    expect(t.skeleton).toBeDefined();
    expect(t["skeleton-pulse"]).toBeDefined();
    expect(t.skeleton).not.toBe(t["skeleton-pulse"]);
  });
});

describe("contrast rules in the stylesheet", () => {
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("tags and skeletons draw the 3:1 outline", () => {
    expect(rule(".cc-tag")).toContain("box-shadow: inset 0 0 0 1px var(--border-strong)");
    expect(rule(".ap-skel")).toContain("box-shadow: inset 0 0 0 1px var(--border-strong)");
    expect(rule(".ap-skel")).toContain("background: var(--skeleton)");
  });

  it("the skeleton pulse fades an overlay inside the outline, never the element itself", () => {
    const start = css.indexOf("@keyframes ap-pulse");
    const keyframes = css.slice(start, css.indexOf("\n}", start));
    expect(keyframes).toContain("opacity");
    expect(rule(".ap-skel")).not.toContain("animation");
    expect(rule(".ap-skel::after")).toContain("inset: 1px");
    expect(rule(".ap-skel::after")).toContain("animation: ap-pulse");
  });
});
