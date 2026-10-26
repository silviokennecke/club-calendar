import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { loadDocPage } from "virtual:docs";
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  LangSwitch,
  Logo,
  Skeleton,
} from "@/components/ui/shared";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { DocRenderer } from "@/docs/DocRenderer";
import { HelpSearch } from "@/docs/HelpSearch";
import { docPath } from "@/docs/paths";
import { groupNav, navFor, resolveDoc, sectionTitles, useDocLang } from "@/docs/nav";
import { usePageTitle } from "@/lib/usePageTitle";
import { cn } from "@/lib/utils";

function PageSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <Skeleton className="block h-9 w-2/3" />
      <Skeleton className="block h-4 w-full" />
      <Skeleton className="block h-4 w-5/6" />
      <Skeleton className="block h-40 w-full" />
    </div>
  );
}

export default function HelpPage() {
  const { t } = useTranslation();
  const uiLang = useDocLang();
  const { pathname, hash } = useLocation();
  const slug = (useParams()["*"] ?? "").replace(/\/+$/, "") || "index";
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = navFor(uiLang);
  const resolved = resolveDoc(uiLang, slug);
  const lang = resolved?.lang ?? uiLang;

  const q = useQuery({
    queryKey: ["doc", lang, slug],
    queryFn: () => loadDocPage(lang, slug),
    enabled: !!resolved,
    staleTime: Infinity,
    retry: false,
  });
  const page = q.data;

  usePageTitle(page?.meta.title ?? (resolved ? t("docs.title") : t("docs.notFoundTitle")));

  useEffect(() => setMenuOpen(false), [pathname]);

  // The page content is not there before the query settles, so anchors resolve afterwards.
  const ready = !!page;
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (el) el.scrollIntoView?.();
    else window.scrollTo?.(0, 0);
  }, [ready, pathname, hash]);

  const groups = useMemo(() => groupNav(nav), [nav]);
  const titles = useMemo(() => sectionTitles(nav), [nav]);
  const at = nav.findIndex((m) => m.slug === slug);
  const prev = at > 0 ? nav[at - 1] : undefined;
  const next = at >= 0 ? nav[at + 1] : undefined;

  const sidebar = (
    <nav aria-label={t("docs.navLabel")} className="space-y-5">
      {groups.map((g) => (
        <div key={g.section || "root"}>
          {g.section && <div className="t-label mb-1 px-3">{g.title}</div>}
          <ul className="m-0 list-none space-y-0.5 p-0">
            {g.pages.map((m) => (
              <li key={m.slug}>
                <Link
                  to={docPath(m.slug)}
                  aria-current={m.slug === slug ? "page" : undefined}
                  className={cn(
                    "text-ink hover:bg-surface-sunken block rounded-md px-3 py-2 no-underline",
                    m.slug === slug && "bg-brand-soft font-bold",
                  )}
                >
                  {m.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  let content;
  if (!resolved) {
    content = (
      <EmptyState
        headingLevel="h1"
        icon="search"
        title={t("docs.notFoundTitle")}
        text={t("docs.notFoundText")}
        actions={
          <Link className="cc-btn cc-btn--primary" to="/help">
            {t("docs.toIndex")}
          </Link>
        }
      />
    );
  } else if (q.isError) {
    content = (
      <EmptyState
        headingLevel="h1"
        icon="alert"
        title={t("docs.loadError")}
        actions={<Button onClick={() => void q.refetch()}>{t("docs.retry")}</Button>}
      />
    );
  } else if (!page) {
    content = <PageSkeleton />;
  } else {
    const toc = page.toc;
    content = (
      <div className="gap-10 xl:grid xl:grid-cols-[minmax(0,1fr)_14rem]">
        {toc.length > 0 && (
          <nav
            aria-label={t("docs.tocLabel")}
            className="border-border mb-6 rounded-lg border p-4 xl:sticky xl:top-24 xl:order-last xl:mb-0 xl:self-start xl:border-0 xl:p-0"
          >
            <div className="t-label mb-2">{t("docs.onThisPage")}</div>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {toc.map((e) => (
                <li key={e.id} className={e.depth > 2 ? "pl-3" : undefined}>
                  <Link
                    to={{ pathname, hash: `#${e.id}` }}
                    className="text-ink-muted hover:text-ink"
                  >
                    {e.text}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <article className="min-w-0">
          <DocRenderer tree={page.tree} />
          {(prev || next) && (
            <nav
              aria-label={t("docs.pagerLabel")}
              className="border-border mt-12 flex flex-wrap justify-between gap-3 border-t pt-6"
            >
              {prev ? (
                <Link
                  to={docPath(prev.slug)}
                  rel="prev"
                  className="ap-link inline-flex items-center gap-2"
                >
                  <Icon glyph="arrow-left" size={18} />
                  <span>
                    <span className="text-ink-muted block text-sm">{t("docs.previous")}</span>
                    {prev.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  to={docPath(next.slug)}
                  rel="next"
                  className="ap-link inline-flex items-center gap-2 text-right"
                >
                  <span>
                    <span className="text-ink-muted block text-sm">{t("docs.next")}</span>
                    {next.title}
                  </span>
                  <Icon glyph="arrow-right" size={18} />
                </Link>
              )}
            </nav>
          )}
        </article>
      </div>
    );
  }

  return (
    <div className="ap bg-surface text-ink min-h-screen">
      <a className="ap-skip cc-btn cc-btn--primary" href="#main">
        {t("shell.skipToContent")}
      </a>
      <header className="border-border bg-surface top-0 z-10 border-b md:sticky">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <IconButton
            className="md:hidden"
            icon={menuOpen ? "x" : "menu"}
            label={menuOpen ? t("docs.closeMenu") : t("docs.openMenu")}
            aria-expanded={menuOpen}
            aria-controls="help-sidebar"
            onClick={() => setMenuOpen((o) => !o)}
          />
          <Link to="/help" className="no-underline" aria-label={t("docs.title")}>
            <Logo />
          </Link>
          <span className="t-h3 hidden sm:inline">{t("docs.title")}</span>
          <div className="order-last w-full md:order-none md:ml-auto md:w-auto md:max-w-md md:flex-1">
            <HelpSearch lang={uiLang} sectionTitles={titles} />
          </div>
          <div className="ml-auto flex items-center gap-3 md:ml-0">
            <Link to="/" className="ap-link hidden text-sm sm:inline">
              {t("docs.backToApp")}
            </Link>
            <LangSwitch />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-10 px-4 py-6">
        <aside
          id="help-sidebar"
          className={cn(
            "w-full shrink-0 md:sticky md:top-24 md:block md:w-60 md:self-start",
            menuOpen ? "block" : "hidden",
          )}
        >
          {sidebar}
        </aside>
        <main
          id="main"
          tabIndex={-1}
          className={cn("min-w-0 flex-1", menuOpen && "hidden md:block")}
        >
          {content}
        </main>
      </div>
      <footer className="pb-10">
        <LegalLinks />
      </footer>
    </div>
  );
}
