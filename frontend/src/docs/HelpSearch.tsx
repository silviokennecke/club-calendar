import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import MiniSearch from "minisearch";
import { loadSearchIndex } from "virtual:docs";
import { SearchInput } from "@/components/ui/shared";
import { DOC_SEARCH_OPTIONS, type DocSearchHit } from "./searchConfig";
import { docPath } from "./paths";
import type { Lang } from "./types";

const MAX_RESULTS = 8;

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
}

interface Props {
  lang: Lang;
  sectionTitles: Record<string, string>;
}

export function HelpSearch({ lang, sectionTitles }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState<{ lang: Lang; ms: MiniSearch } | null>(null);
  const loading = useRef<Lang | null>(null);

  function ensureIndex() {
    if (loading.current === lang) return;
    loading.current = lang;
    loadSearchIndex(lang)
      .then((json) => setIndex({ lang, ms: MiniSearch.loadJSON(json, DOC_SEARCH_OPTIONS) }))
      .catch(() => {
        loading.current = null;
      });
  }

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const term = query.trim();
  const hits: DocSearchHit[] =
    term && index?.lang === lang
      ? (index.ms
          .search(term, { prefix: true, fuzzy: 0.2, boost: { title: 2 } })
          .slice(0, MAX_RESULTS) as unknown as DocSearchHit[])
      : [];
  const showList = open && term !== "";
  const pending = term !== "" && index?.lang !== lang;
  const activeIdx = Math.min(active, Math.max(hits.length - 1, 0));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  function go(hit: DocSearchHit) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    void navigate(docPath(hit.slug, hit.anchor || undefined));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      if (hits.length) {
        setActive((activeIdx + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length);
      }
    } else if (e.key === "Enter" && showList && hits[activeIdx]) {
      e.preventDefault();
      go(hits[activeIdx]);
    }
  }

  return (
    <div
      className="relative w-full max-w-md"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v);
          setActive(0);
          setOpen(true);
          ensureIndex();
        }}
        placeholder={t("docs.searchPlaceholder")}
        label={t("docs.searchLabel")}
        inputRef={inputRef}
        inputProps={{
          role: "combobox",
          "aria-expanded": showList,
          "aria-controls": listId,
          "aria-autocomplete": "list",
          "aria-activedescendant": showList && hits.length ? optionId(activeIdx) : undefined,
          onFocus: () => {
            setOpen(true);
            ensureIndex();
          },
          onKeyDown,
        }}
      />
      {showList && (
        <div
          className="border-border bg-surface-raised absolute top-full right-0 left-0 z-20 mt-2 max-h-96 overflow-y-auto rounded-lg border shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          <ul
            id={listId}
            role="listbox"
            aria-label={t("docs.searchResults")}
            className="m-0 list-none p-1"
          >
            {hits.map((hit, i) => (
              <li key={hit.id} role="presentation">
                <Link
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === activeIdx}
                  tabIndex={-1}
                  to={docPath(hit.slug, hit.anchor || undefined)}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`text-ink block rounded-md px-3 py-2 no-underline ${i === activeIdx ? "bg-brand-soft" : ""}`}
                >
                  <span className="block font-bold">{hit.title}</span>
                  <span className="text-ink-muted block text-sm">
                    {[sectionTitles[hit.section], hit.heading].filter(Boolean).join(" · ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {hits.length === 0 && (
            <p role="status" className="t-sm text-ink-muted m-0 px-4 py-3">
              {pending ? t("common.loading") : t("docs.noResults", { query: term })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
