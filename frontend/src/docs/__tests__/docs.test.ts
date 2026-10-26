import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import MiniSearch from "minisearch";
import { compileDocs, renderSlugsFile, SHOT_PREFIX } from "../../../vite/docs-compiler";
import { DOC_SEARCH_OPTIONS } from "../searchConfig";
import { DOC_SLUGS } from "../slugs.generated";
import type { DocNode } from "../types";

const fixtures = path.resolve(__dirname, "fixtures/docs");
const realDocs = path.resolve(__dirname, "../../../docs");
const slugsFile = path.resolve(__dirname, "../slugs.generated.ts");

function find(n: DocNode, pred: (e: Extract<DocNode, { type: "element" }>) => boolean) {
  const out: Extract<DocNode, { type: "element" }>[] = [];
  const walk = (x: DocNode) => {
    if (x.type !== "element") return;
    if (pred(x)) out.push(x);
    x.children.forEach(walk);
  };
  walk(n);
  return out;
}
const text = (n: DocNode): string => (n.type === "text" ? n.value : n.children.map(text).join(""));

describe("docs compiler", () => {
  it("compiles frontmatter, nav, toc, callout, links, shots and drops raw html", async () => {
    const docs = await compileDocs(fixtures);
    expect(docs.slugs).toEqual(["events/series", "index"]);
    expect(docs.nav.de.map((m) => m.slug)).toEqual(["index", "events/series"]);
    const page = docs.pages.en["events/series"];
    expect(page.meta).toEqual({
      slug: "events/series",
      title: "Series en",
      section: "events",
      order: 5,
      description: "About series",
    });
    expect(page.toc).toEqual([
      { depth: 2, id: "weekly-rhythm", text: "Weekly rhythm" },
      { depth: 3, id: "details", text: "Details" },
    ]);
    const callout = find(page.tree, (e) => e.props["data-callout"] === "warning");
    expect(callout[0].tag).toBe("div");
    expect(text(callout[0])).toContain("Careful here.");
    const help = find(page.tree, (e) => e.props["data-help"] !== undefined)[0];
    expect(help.props).toMatchObject({ "data-help": "index#start" });
    expect(help.props.href).toBeUndefined();
    const ext = find(page.tree, (e) => e.props.href === "https://example.com")[0];
    expect(ext.props).toMatchObject({ target: "_blank", rel: "noopener noreferrer" });
    const img = find(page.tree, (e) => e.tag === "img")[0];
    expect(img.props.src).toBe(SHOT_PREFIX + "0");
    expect(page.shots).toEqual([path.join(fixtures, "screenshots/en/shot1.png")]);
    expect(JSON.stringify(page.tree)).not.toContain("alert(1)");
    expect(text(page.tree)).toContain("10:30");
  });

  it("builds a search index with page and heading entries", async () => {
    const docs = await compileDocs(fixtures);
    const ms = MiniSearch.loadJSON<unknown>(docs.searchIndex.en, DOC_SEARCH_OPTIONS);
    const hits = ms.search("zebra");
    expect(hits[0]).toMatchObject({ slug: "events/series", anchor: "details" });
    expect(ms.search("weekly").some((h) => h.anchor === "weekly-rhythm")).toBe(true);
    expect(ms.search("series").some((h) => h.id === "events/series")).toBe(true);
  });

  it("fails on a missing screenshot, unknown help slug and missing translation", async () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "docs-"));
    fs.cpSync(fixtures, tmp, { recursive: true });
    const en = path.join(tmp, "en/events/series.md");
    const orig = fs.readFileSync(en, "utf8");

    fs.writeFileSync(en, orig.replace("shot:shot1", "shot:nope"));
    await expect(compileDocs(tmp)).rejects.toThrow(/en\/events\/series\.md.*"nope"/);

    fs.writeFileSync(en, orig.replace("help:index#start", "help:ghost"));
    await expect(compileDocs(tmp)).rejects.toThrow(/unknown page "ghost"/);

    fs.writeFileSync(en, orig);
    fs.rmSync(path.join(tmp, "de/events/series.md"));
    await expect(compileDocs(tmp)).rejects.toThrow(
      /events\/series \(exists in en, missing in de\)/,
    );

    fs.writeFileSync(path.join(tmp, "de/events/series.md"), "no frontmatter");
    await expect(compileDocs(tmp)).rejects.toThrow(/missing frontmatter title/);
    fs.rmSync(tmp, { recursive: true });
  });
});

describe("real docs", () => {
  it("has the same pages in de and en and a committed, current slugs file", async () => {
    const docs = await compileDocs(realDocs);
    expect(docs.nav.de.map((m) => m.slug)).toEqual(docs.nav.en.map((m) => m.slug));
    expect(docs.nav.de.length).toBeGreaterThan(0);
    expect([...DOC_SLUGS]).toEqual(docs.slugs);
    expect(fs.readFileSync(slugsFile, "utf8")).toBe(await renderSlugsFile(docs.slugs, slugsFile));
  });

  it("serves pages and the search index through the virtual module", async () => {
    const { docNav, loadDocPage, loadSearchIndex } = await import("virtual:docs");
    expect(docNav.de.length).toBe(docNav.en.length);
    const page = await loadDocPage("de", "getting-started/first-steps");
    expect(page.meta.title).toBe("Erste Schritte");
    const img = find(page.tree, (e) => e.tag === "img")[0];
    expect(typeof img.props.src).toBe("string");
    expect(String(img.props.src)).not.toContain(SHOT_PREFIX);
    await expect(loadDocPage("de", "nope")).rejects.toThrow();
    const ms = MiniSearch.loadJSON<unknown>(await loadSearchIndex("en"), DOC_SEARCH_OPTIONS);
    expect(ms.search("invite").length).toBeGreaterThan(0);
  });
});
