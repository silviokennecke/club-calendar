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

vi.mock("@/components/legal/LegalLinks", () => ({
  LegalLinks: () => <span data-testid="legal-links" />,
}));

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
      { slug: "events/index", title: "Termine", section: "events", order: 0 },
      { slug: "events/series", title: "Terminreihen", section: "events", order: 10 },
      { slug: "publishing/feeds", title: "Feeds", section: "publishing", order: 10 },
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

for (const [slug, title, section] of [
  ["events/index", "Termine", "events"],
  ["events/series", "Terminreihen", "events"],
  ["publishing/feeds", "Feeds", "publishing"],
] as const) {
  pages[slug] = {
    meta: { slug, title, section, order: 0 },
    toc: [],
    tree: el("div", {}, el("h1", { id: slug }, `${title} Inhalt`)),
  };
}

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

  describe("tabs", () => {
    const tabsTree = (platform: boolean) =>
      el(
        "div",
        {},
        el(
          "div",
          { "data-tabs": "app", ...(platform ? { "data-platform": true } : {}) },
          el("div", { "data-tab": "ios", "data-label": "iPhone" }, el("p", {}, "iOS Text")),
          el("div", { "data-tab": "google", "data-label": "Google" }, el("p", {}, "Google Text")),
        ),
      );
    const renderTabs = (tree: DocNode, at = "/help") =>
      render(
        <MemoryRouter initialEntries={[at]}>
          <DocRenderer tree={tree} />
          <Where />
        </MemoryRouter>,
      );

    it("defaults to the first tab and switches with click and arrow keys, mirrored into the URL", async () => {
      const user = userEvent.setup();
      renderTabs(tabsTree(false));
      const ios = screen.getByRole("tab", { name: "iPhone" });
      expect(ios).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("iOS Text");
      await user.click(screen.getByRole("tab", { name: "Google" }));
      expect(screen.getByRole("tab", { name: "Google" })).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tabpanel")).toHaveTextContent("Google Text");
      await user.keyboard("{ArrowLeft}");
      expect(screen.getByRole("tab", { name: "iPhone" })).toHaveAttribute("aria-selected", "true");
    });

    it("lets the query param win over the platform preselect, which wins over the first tab", () => {
      vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14)");
      const { unmount } = renderTabs(tabsTree(true));
      expect(screen.getByRole("tab", { name: "Google" })).toHaveAttribute("aria-selected", "true");
      unmount();
      renderTabs(tabsTree(true), "/help?app=ios");
      expect(screen.getByRole("tab", { name: "iPhone" })).toHaveAttribute("aria-selected", "true");
      vi.restoreAllMocks();
    });

    it("writes the active tab into the URL query", async () => {
      const user = userEvent.setup();
      function Search() {
        return <output data-testid="search">{useLocation().search}</output>;
      }
      render(
        <MemoryRouter initialEntries={["/help?x=1"]}>
          <DocRenderer tree={tabsTree(false)} />
          <Search />
        </MemoryRouter>,
      );
      await user.click(screen.getByRole("tab", { name: "Google" }));
      expect(screen.getByTestId("search")).toHaveTextContent("?x=1&app=google");
    });
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
    expect(helpPath("getting-started/set-up", "verein-anlegen")).toBe(
      "/help/getting-started/set-up#verein-anlegen",
    );
    function Probe() {
      return <span data-testid="url">{useHelpUrl("getting-started/set-up")}</span>;
    }
    render(
      <MemoryRouter>
        <HelpLink page="getting-started/set-up" anchor="verein-anlegen" newTab>
          Mehr
        </HelpLink>
        <Probe />
      </MemoryRouter>,
    );
    const a = screen.getByRole("link", { name: "Mehr" });
    expect(a).toHaveAttribute("href", "/help/getting-started/set-up#verein-anlegen");
    expect(a).toHaveAttribute("target", "_blank");
    expect(screen.getByTestId("url")).toHaveTextContent("/help/getting-started/set-up");
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

  it("shows the legal footer and no help link in it", async () => {
    renderAt("/help");
    await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ });
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByTestId("legal-links")).toBeInTheDocument();
    expect(within(footer).queryByRole("link")).not.toBeInTheDocument();
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

  describe("collapsible sections", () => {
    const toggle = (name: string) => screen.getByRole("button", { name });
    const nav = () => screen.getByRole("navigation", { name: "Hilfe-Navigation" });

    it("collapses every section except the one of the current page", async () => {
      renderAt("/help/getting-started/first-steps");
      await screen.findByText(/Erste Schritte Inhalt/);
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "true");
      expect(toggle("Publishing")).toHaveAttribute("aria-expanded", "false");
      expect(toggle("Termine")).toHaveAttribute("aria-expanded", "false");
      const list = document.getElementById(toggle("Publishing").getAttribute("aria-controls")!)!;
      expect(list).toHaveAttribute("inert");
      expect(within(nav()).getByRole("link", { name: "Erste Schritte" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("keeps root pages as plain links", async () => {
      renderAt("/help");
      await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ });
      expect(within(nav()).getByRole("link", { name: "Hilfe" })).toBeInTheDocument();
      expect(within(nav()).queryByRole("button", { name: "Hilfe" })).not.toBeInTheDocument();
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "false");
    });

    it("expands the section of a generated table of contents", async () => {
      renderAt("/help/getting-started");
      await screen.findByRole("heading", { level: 1, name: "Getting started" });
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "true");
    });

    it("toggles by click and keyboard", async () => {
      const user = userEvent.setup();
      renderAt("/help");
      await screen.findByRole("heading", { level: 1, name: /Hilfe Start/ });
      const btn = toggle("Getting started");
      await user.click(btn);
      expect(btn).toHaveAttribute("aria-expanded", "true");
      const region = document.getElementById(btn.getAttribute("aria-controls")!)!;
      expect(region).not.toHaveAttribute("inert");
      btn.focus();
      await user.keyboard("{Enter}");
      expect(btn).toHaveAttribute("aria-expanded", "false");
      expect(region).toHaveAttribute("inert");
      await user.keyboard(" ");
      expect(btn).toHaveAttribute("aria-expanded", "true");
    });

    it("expands the target section on navigation and keeps opened sections open", async () => {
      const user = userEvent.setup();
      renderAt("/help/getting-started/first-steps");
      await screen.findByText(/Erste Schritte Inhalt/);
      await user.click(toggle("Publishing"));
      await user.click(screen.getByRole("link", { name: /^Weiter\s*Termine/ }));
      await screen.findByText(/Termine Inhalt/);
      expect(toggle("Termine")).toHaveAttribute("aria-expanded", "true");
      expect(toggle("Publishing")).toHaveAttribute("aria-expanded", "true");
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "true");
    });

    it("expands the section of a search result", async () => {
      const user = userEvent.setup();
      renderAt("/help/publishing/feeds");
      await screen.findByText(/Feeds Inhalt/);
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "false");
      await user.click(screen.getByRole("combobox"));
      await user.keyboard("verein");
      await screen.findByRole("option", { name: /Erste Schritte/ });
      await user.keyboard("{Enter}");
      await screen.findByText(/Erste Schritte Inhalt/);
      expect(toggle("Getting started")).toHaveAttribute("aria-expanded", "true");
    });

    it("gives a section with an index page a title link and a separate toggle", async () => {
      const user = userEvent.setup();
      renderAt("/help/events/series");
      await screen.findByText(/Terminreihen Inhalt/);
      const link = within(nav()).getByRole("link", { name: "Termine" });
      expect(link).toHaveAttribute("href", "/help/events");
      expect(link).not.toHaveAttribute("aria-current");
      const btn = toggle("Termine");
      expect(btn).toHaveAttribute("aria-expanded", "true");
      await user.click(btn);
      expect(btn).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("where")).toHaveTextContent("/help/events/series");
      await user.click(link);
      await screen.findByText(/Termine Inhalt/);
      expect(screen.getByRole("link", { name: "Termine" })).toHaveAttribute("aria-current", "page");
      expect(toggle("Termine")).toHaveAttribute("aria-expanded", "true");
    });
  });
});
