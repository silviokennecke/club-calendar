import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import MiniSearch from "minisearch";
import i18n from "@/lib/i18n";
import { DOC_SEARCH_OPTIONS } from "../searchConfig";
import type { DocNode, DocPage, DocMeta } from "../types";
import { DocRenderer } from "../DocRenderer";
import { HelpLink } from "../HelpLink";
import { helpPath, useHelpUrl } from "../paths";

const el = (
  tag: string,
  props: Record<string, string | number | boolean>,
  ...children: (DocNode | string)[]
): DocNode => ({
  type: "element",
  tag,
  props,
  children: children.map((c) => (typeof c === "string" ? { type: "text", value: c } : c)),
});

const metaIndex: DocMeta = { slug: "index", title: "Hilfe", section: "", order: 0 };
const metaFirst: DocMeta = {
  slug: "getting-started/first-steps",
  title: "Erste Schritte",
  section: "getting-started",
  order: 10,
};

const pages: Record<string, DocPage> = {
  index: {
    meta: metaIndex,
    toc: [{ depth: 2, id: "willkommen", text: "Willkommen" }],
    tree: el(
      "div",
      {},
      el("h1", { id: "start" }, "Hilfe Start"),
      el("h2", { id: "willkommen" }, "Willkommen"),
    ),
  },
  "getting-started/first-steps": {
    meta: metaFirst,
    toc: [{ depth: 2, id: "verein-anlegen", text: "Verein anlegen" }],
    tree: el(
      "div",
      {},
      el("h1", { id: "erste" }, "Erste Schritte Inhalt"),
      el("h2", { id: "verein-anlegen" }, "Verein anlegen"),
    ),
  },
};

vi.mock("virtual:docs", () => ({
  docNav: {
    de: [
      { slug: "index", title: "Hilfe", section: "", order: 0 },
      {
        slug: "getting-started/first-steps",
        title: "Erste Schritte",
        section: "getting-started",
        order: 10,
      },
    ],
    en: [],
  },
  loadDocPage: (_lang: string, slug: string) =>
    pages[slug] ? Promise.resolve(pages[slug]) : Promise.reject(new Error("unknown")),
  loadSearchIndex: async () => {
    const ms = new MiniSearch(DOC_SEARCH_OPTIONS);
    ms.add({
      id: "0",
      slug: "getting-started/first-steps",
      title: "Erste Schritte",
      section: "getting-started",
      anchor: "verein-anlegen",
      heading: "Verein anlegen",
      text: "Lege zuerst einen Verein an",
    });
    return JSON.stringify(ms);
  },
}));

const { default: HelpPage } = await import("@/pages/HelpPage");

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.hash}</output>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {/* Like the app: the routes sit below an outer splat route (its "*" param leaks into /help). */}
        <Routes>
          <Route
            path="*"
            element={
              <Routes>
                <Route path="/help" element={<HelpPage />} />
                <Route path="/help/*" element={<HelpPage />} />
              </Routes>
            }
          />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  await i18n.changeLanguage("de");
});

describe("DocRenderer", () => {
  function renderTree(tree: DocNode) {
    return render(
      <MemoryRouter>
        <DocRenderer tree={tree} />
      </MemoryRouter>,
    );
  }

  it("renders callouts, internal help links and external links", () => {
    renderTree(
      el(
        "div",
        {},
        el("h2", { id: "abschnitt" }, "Abschnitt"),
        el("div", { "data-callout": "warning" }, el("p", {}, "Vorsicht hier.")),
        el(
          "p",
          {},
          el("a", { "data-help": "getting-started/first-steps#verein-anlegen" }, "intern"),
        ),
        el("p", {}, el("a", { href: "https://example.com", target: "_blank" }, "extern")),
        el("img", { src: "/x.png", alt: "Bild" }),
      ),
    );
    const callout = screen.getByRole("note");
    expect(callout).toHaveAttribute("data-callout", "warning");
    expect(callout).toHaveTextContent("Vorsicht hier.");
    expect(screen.getByRole("link", { name: "intern" })).toHaveAttribute(
      "href",
      "/help/getting-started/first-steps#verein-anlegen",
    );
    const ext = screen.getByRole("link", { name: "extern" });
    expect(ext).toHaveAttribute("href", "https://example.com");
    expect(ext).toHaveAttribute("target", "_blank");
    expect(ext).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("heading", { name: /Abschnitt/ })).toHaveAttribute("id", "abschnitt");
    expect(screen.getByRole("link", { name: "Link zu diesem Abschnitt" })).toHaveAttribute(
      "href",
      "#abschnitt",
    );
    const img = screen.getByRole("img", { name: "Bild" });
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("maps help:index to /help", () => {
    renderTree(el("p", {}, el("a", { "data-help": "index" }, "start")));
    expect(screen.getByRole("link", { name: "start" })).toHaveAttribute("href", "/help");
  });

  it("does not inject markup from text", () => {
    renderTree(el("p", {}, "<img src=x onerror=alert(1)>"));
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("HelpLink", () => {
  it("builds paths and renders a router link", () => {
    expect(helpPath("index")).toBe("/help");
    expect(helpPath("getting-started/first-steps", "verein-anlegen")).toBe(
      "/help/getting-started/first-steps#verein-anlegen",
    );
    function Probe() {
      return <span data-testid="url">{useHelpUrl("getting-started/first-steps")}</span>;
    }
    render(
      <MemoryRouter>
        <HelpLink page="getting-started/first-steps" anchor="verein-anlegen" newTab>
          Mehr
        </HelpLink>
        <Probe />
      </MemoryRouter>,
    );
    const a = screen.getByRole("link", { name: "Mehr" });
    expect(a).toHaveAttribute("href", "/help/getting-started/first-steps#verein-anlegen");
    expect(a).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("url")).toHaveTextContent("/help/getting-started/first-steps");
  });

  it("rejects unknown slugs at compile time", () => {
    // @ts-expect-error not a DocSlug
    helpPath("does/not-exist");
  });
});

describe("HelpPage", () => {
  it("renders the index with navigation, toc and pager", async () => {
    renderAt("/help");
    expect(
      await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Hilfe-Navigation" });
    expect(nav).toHaveTextContent("Getting started");
    expect(nav).toHaveTextContent("Erste Schritte");
    expect(screen.getByRole("navigation", { name: "Inhaltsverzeichnis" })).toHaveTextContent(
      "Willkommen",
    );
    expect(screen.getByRole("link", { name: /Weiter/ })).toHaveAttribute(
      "href",
      "/help/getting-started/first-steps",
    );
    await waitFor(() => expect(document.title).toContain("Hilfe"));
  });

  it.each(["/help/", "/help/index"])("renders the index at %s", async (path) => {
    renderAt(path);
    expect(
      await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ }),
    ).toBeInTheDocument();
  });

  it("renders a nested slug with a trailing slash", async () => {
    renderAt("/help/getting-started/first-steps/");
    expect(await screen.findByText(/Erste Schritte Inhalt/)).toBeInTheDocument();
  });

  it.each(["/help/getting-started", "/help/getting-started/"])(
    "shows a default table of contents at %s",
    async (path) => {
      renderAt(path);
      expect(
        await screen.findByRole("heading", { level: 1, name: "Getting started" }),
      ).toBeInTheDocument();
      const link = within(screen.getByRole("main")).getByRole("link", { name: /Erste Schritte/ });
      expect(link).toHaveAttribute("href", "/help/getting-started/first-steps");
      expect(screen.getByRole("navigation", { name: "Hilfe-Navigation" })).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
    },
  );

  it("renders a nested slug", async () => {
    renderAt("/help/getting-started/first-steps");
    expect(await screen.findByText(/Erste Schritte Inhalt/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Zurück\s*Hilfe/ })).toHaveAttribute("href", "/help");
  });

  it("shows a not-found state inside the help layout", async () => {
    renderAt("/help/nope");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Seite nicht gefunden" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Hilfe-Navigation" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zur Hilfe-Übersicht" })).toHaveAttribute(
      "href",
      "/help",
    );
  });

  it("searches, navigates by keyboard and shows an empty state", async () => {
    const user = userEvent.setup();
    renderAt("/help");
    await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ });
    const box = screen.getByRole("combobox");

    await user.click(box);
    await user.keyboard("verein");
    const option = await screen.findByRole("option", { name: /Erste Schritte/ });
    expect(option).toHaveTextContent("Getting started · Verein anlegen");
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByTestId("where")).toHaveTextContent(
        "/help/getting-started/first-steps#verein-anlegen",
      ),
    );

    await user.click(screen.getByRole("combobox"));
    await user.keyboard("zzzzqq");
    expect(await screen.findByText(/Keine Treffer/)).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/Keine Treffer/)).not.toBeInTheDocument();
  });

  it("focuses the search with the slash key", async () => {
    const user = userEvent.setup();
    renderAt("/help");
    await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ });
    await user.keyboard("/");
    expect(screen.getByRole("combobox")).toHaveFocus();
  });
});
