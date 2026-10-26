import fs from "fs";
import path from "path";
import type { Plugin, ViteDevServer } from "vite";
import { compileDocs, renderSlugsFile, SHOT_PREFIX, type CompiledDocs } from "./docs-compiler";
import { DOC_LANGS, type Lang } from "../src/docs/types";

const ID = "virtual:docs";
const PAGE = "virtual:docs-page/";
const SEARCH = "virtual:docs-search/";
const RESOLVED = "\0";

export default function docsPlugin(opts: { docsDir?: string; slugsFile?: string } = {}): Plugin {
  const docsDir = opts.docsDir ?? path.resolve(__dirname, "../docs");
  const slugsFile = opts.slugsFile ?? path.resolve(__dirname, "../src/docs/slugs.generated.ts");
  let cache: Promise<CompiledDocs> | null = null;
  let server: ViteDevServer | undefined;

  const compiled = () => (cache ??= compileDocs(docsDir));

  async function syncSlugs(docs: CompiledDocs) {
    // Under Vitest the committed file must stay untouched so the sync test can catch drift.
    if (process.env.VITEST) return;
    const next = await renderSlugsFile(docs.slugs, slugsFile);
    const prev = fs.existsSync(slugsFile) ? fs.readFileSync(slugsFile, "utf8") : "";
    if (next !== prev) fs.writeFileSync(slugsFile, next);
  }

  function invalidate() {
    cache = null;
    if (!server) return;
    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      if (mod.id?.startsWith(RESOLVED + "virtual:docs")) server.moduleGraph.invalidateModule(mod);
    }
    server.ws.send({ type: "full-reload" });
  }

  return {
    name: "docs",
    configureServer(s) {
      server = s;
      s.watcher.add(docsDir);
      const onChange = (file: string) => {
        if (file.startsWith(docsDir + path.sep)) invalidate();
      };
      s.watcher.on("add", onChange).on("change", onChange).on("unlink", onChange);
    },
    async buildStart() {
      try {
        const docs = await compiled();
        await syncSlugs(docs);
        docs.files.forEach((f) => this.addWatchFile(f));
      } catch (e) {
        // In dev the error surfaces when the module is requested; a build must fail.
        if (!server) throw e;
        cache = null;
      }
    },
    resolveId(id) {
      if (id === ID || id.startsWith(PAGE) || id.startsWith(SEARCH)) return RESOLVED + id;
      return null;
    },
    async load(rid) {
      if (!rid.startsWith(RESOLVED + "virtual:docs")) return null;
      const id = rid.slice(1);
      const docs = await compiled();
      if (id === ID) return rootModule(docs);
      if (id.startsWith(SEARCH)) {
        return `export default ${JSON.stringify(docs.searchIndex[id.slice(SEARCH.length) as Lang])};`;
      }
      const [lang, ...rest] = id.slice(PAGE.length).split("/");
      const page = docs.pages[lang as Lang]?.[rest.join("/")];
      if (!page) throw new Error(`[docs] unknown page ${id}`);
      const imports = page.shots
        .map((f, i) => `import shot${i} from ${JSON.stringify(f)};`)
        .join("\n");
      return `${imports}
const shots = [${page.shots.map((_, i) => `shot${i}`).join(", ")}];
const page = ${JSON.stringify({ meta: page.meta, toc: page.toc, tree: page.tree })};
(function fix(n) {
  if (n.type !== "element") return;
  const s = n.props.src;
  if (typeof s === "string" && s.startsWith(${JSON.stringify(SHOT_PREFIX)})) n.props.src = shots[Number(s.slice(${SHOT_PREFIX.length}))];
  n.children.forEach(fix);
})(page.tree);
export default page;
`;
    },
  };
}

function rootModule(docs: CompiledDocs): string {
  const loaders = DOC_LANGS.map(
    (l) =>
      `${l}: {\n${Object.keys(docs.pages[l])
        .map(
          (s) => `    ${JSON.stringify(s)}: () => import(${JSON.stringify(PAGE + l + "/" + s)}),`,
        )
        .join("\n")}\n  }`,
  ).join(",\n  ");
  const searches = DOC_LANGS.map((l) => `${l}: () => import(${JSON.stringify(SEARCH + l)})`).join(
    ", ",
  );
  return `export const docNav = ${JSON.stringify(docs.nav)};
const pages = {\n  ${loaders}\n};
const searches = { ${searches} };
export function loadDocPage(lang, slug) {
  const load = Object.hasOwn(pages[lang] ?? {}, slug) ? pages[lang][slug] : undefined;
  return load ? load().then((m) => m.default) : Promise.reject(new Error("Unknown doc page: " + lang + "/" + slug));
}
export function loadSearchIndex(lang) {
  return searches[lang]().then((m) => m.default);
}
`;
}
