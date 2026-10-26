import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { compileDocs } from "../../../vite/docs-compiler";
import { docPath } from "../paths";

const m = (slug: string, title: string, order = 10, description?: string) => ({
  slug,
  title,
  section: slug.includes("/") ? slug.split("/")[0] : "",
  order,
  ...(description ? { description } : {}),
});

vi.mock("virtual:docs", () => ({
  docNav: {
    de: [
      m("index", "Hilfe", 0),
      m("getting-started/first-steps", "Erste Schritte", 10, "Verein anlegen"),
      m("getting-started/second", "Zweiter", 20),
      m("getting-started/deep/leaf", "Blatt", 5, "Tief"),
      m("events/index", "Termine", 0, "Alles zu Terminen"),
      m("events/series", "Serien", 10),
      m("events/more/index", "Mehr", 30),
      m("events/more/a", "A", 1),
    ],
    en: [m("index", "Help", 0), m("only-en/x", "X")],
  },
}));

const { resolveHelpPath, normalizeHelpPath, groupNav } = await import("../nav");

describe("resolveHelpPath", () => {
  it.each(["/help", "/help/", "/help/index", "/help/index/", "", "/"])("root: %s", (p) => {
    const r = resolveHelpPath("de", p);
    expect(r).toMatchObject({ kind: "page", meta: { slug: "index" } });
  });

  it("resolves pages with and without trailing slash", () => {
    for (const p of [
      "/help/getting-started/first-steps",
      "/help/getting-started/first-steps/",
      "getting-started/first-steps",
    ])
      expect(resolveHelpPath("de", p)).toMatchObject({
        kind: "page",
        meta: { slug: "getting-started/first-steps" },
      });
  });

  it("uses a folder index page when present", () => {
    for (const p of ["/help/events", "/help/events/", "/help/events/index"])
      expect(resolveHelpPath("de", p)).toMatchObject({
        kind: "page",
        meta: { slug: "events/index" },
      });
  });

  it("builds a default TOC otherwise, ordered, with child folders", () => {
    const r = resolveHelpPath("de", "/help/getting-started/");
    expect(r).toMatchObject({
      kind: "section",
      folder: "getting-started",
      title: "Getting started",
    });
    if (r?.kind !== "section") throw new Error();
    expect(r.entries.map((e) => [e.kind, e.slug, e.title])).toEqual([
      ["folder", "getting-started/deep", "Deep"],
      ["page", "getting-started/first-steps", "Erste Schritte"],
      ["page", "getting-started/second", "Zweiter"],
    ]);
    expect(r.entries[1].description).toBe("Verein anlegen");
  });

  it("handles nested folders", () => {
    const r = resolveHelpPath("de", "/help/getting-started/deep");
    expect(r).toMatchObject({ kind: "section", title: "Deep" });
    if (r?.kind !== "section") throw new Error();
    expect(r.entries.map((e) => e.slug)).toEqual(["getting-started/deep/leaf"]);
    expect(resolveHelpPath("de", "/help/events/more")).toMatchObject({
      kind: "page",
      meta: { slug: "events/more/index" },
    });
  });

  it("returns null for unknown paths", () => {
    for (const p of [
      "/help/nope",
      "/help/getting-started/nope",
      "/help/getting",
      "/help/events/series/x",
    ])
      expect(resolveHelpPath("de", p)).toBeNull();
  });

  it("falls back to German", () => {
    expect(resolveHelpPath("en", "/help/getting-started/first-steps")).toMatchObject({
      kind: "page",
      lang: "de",
    });
    expect(resolveHelpPath("en", "/help/getting-started")).toMatchObject({
      kind: "section",
      lang: "de",
    });
    expect(resolveHelpPath("en", "/help/only-en")).toMatchObject({ kind: "section", lang: "en" });
    expect(resolveHelpPath("en", "/help")).toMatchObject({ kind: "page", lang: "en" });
  });

  it("normalizes paths", () => {
    expect(normalizeHelpPath("/help//a///b/?x=1#y")).toBe("a/b");
    expect(normalizeHelpPath("/helpful")).toBe("helpful");
  });

  it("uses <folder>/index as section index in the sidebar groups", () => {
    const g = groupNav([m("events/index", "Termine", 0), m("events/series", "Serien")]);
    expect(g[0]).toMatchObject({ section: "events", title: "Termine" });
    expect(g[0].indexPage?.slug).toBe("events/index");
  });
});

describe("docPath", () => {
  it("maps index slugs to folder URLs", () => {
    expect(docPath("index")).toBe("/help");
    expect(docPath("events/index", "a")).toBe("/help/events#a");
    expect(docPath("events/more/index")).toBe("/help/events/more");
    expect(docPath("events/series")).toBe("/help/events/series");
  });
});

describe("compiler: nested index pages", () => {
  it("names them <folder>/index and accepts help:<folder>/index links", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-"));
    for (const l of ["de", "en"]) {
      fs.mkdirSync(path.join(root, l, "events"), { recursive: true });
      fs.writeFileSync(
        path.join(root, l, "index.md"),
        `---\ntitle: Home\n---\n[x](help:events/index)\n`,
      );
      fs.writeFileSync(path.join(root, l, "events/index.md"), `---\ntitle: Events\n---\nHi\n`);
    }
    const docs = await compileDocs(root);
    expect(docs.slugs).toEqual(["events/index", "index"]);
    expect(docs.nav.de.find((x) => x.slug === "events/index")?.section).toBe("events");
    fs.rmSync(root, { recursive: true });
  });
});
