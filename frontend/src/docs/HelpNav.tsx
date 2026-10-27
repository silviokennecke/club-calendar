import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/ui/shared";
import { cn } from "@/lib/utils";
import { docPath } from "./paths";
import type { NavGroup } from "./nav";

interface HelpNavProps {
  label: string;
  groups: NavGroup[];
  /** Slug of the shown page ("" when a section table of contents or an error is shown). */
  slug: string;
  /** Section of the shown page or table of contents: always expanded on arrival. */
  activeSection: string;
}

const rowClass = "text-ink hover:bg-surface-sunken rounded-md no-underline";

const topRow = "text-base font-semibold";

/** `top`: root pages, same tier as section rows. Otherwise a page below a section (smaller, lighter). */
function PageLink({
  slug,
  title,
  current,
  top,
}: {
  slug: string;
  title: string;
  current: boolean;
  top?: boolean;
}) {
  return (
    <Link
      to={docPath(slug)}
      aria-current={current ? "page" : undefined}
      className={cn(
        rowClass,
        "block px-3 py-1.5",
        top ? topRow : "text-ink-muted hover:text-ink text-sm font-normal",
        current && (top ? "bg-brand-soft" : "bg-brand-soft text-ink font-medium"),
      )}
    >
      {title}
    </Link>
  );
}

function Section({
  group,
  slug,
  open,
  onToggle,
}: {
  group: NavGroup;
  slug: string;
  open: boolean;
  onToggle: () => void;
}) {
  const uid = useId();
  const regionId = `${uid}-pages`;
  const titleId = `${uid}-title`;
  const index = group.indexPage;
  const pages = group.pages.filter((m) => m !== index);

  const chevron = (
    <Icon
      glyph="chevron-right"
      size={16}
      aria-hidden
      className={cn(
        "shrink-0 transition-transform duration-[var(--dur-base)] ease-[var(--ease-out)] motion-reduce:transition-none",
        open && "rotate-90",
      )}
    />
  );

  return (
    <div>
      {index ? (
        <div className="flex items-center">
          <Link
            id={titleId}
            to={docPath(index.slug)}
            aria-current={index.slug === slug ? "page" : undefined}
            className={cn(
              rowClass,
              topRow,
              "min-w-0 flex-1 px-3 py-1.5",
              index.slug === slug && "bg-brand-soft",
            )}
          >
            {group.title}
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={regionId}
            aria-labelledby={titleId}
            onClick={onToggle}
            className={cn(rowClass, "text-ink-muted grid size-9 shrink-0 place-items-center")}
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={onToggle}
          className={cn(
            rowClass,
            topRow,
            "flex w-full items-center justify-between px-3 py-1.5 text-left",
          )}
        >
          <span>{group.title}</span>
          {chevron}
        </button>
      )}
      <div
        id={regionId}
        className="ap-collapse"
        data-open={open ? "true" : "false"}
        inert={!open}
        aria-hidden={!open || undefined}
      >
        <div className="ap-collapse-inner">
          <ul className="border-border m-0 mt-0.5 ml-4 list-none space-y-0.5 border-l p-0 pl-2">
            {pages.map((m) => (
              <li key={m.slug}>
                <PageLink slug={m.slug} title={m.title} current={m.slug === slug} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Help sidebar: root pages are plain links, every section is a disclosure. */
export function HelpNav({ label, groups, slug, activeSection }: HelpNavProps) {
  const [openSections, setOpenSections] = useState(
    () => new Set(activeSection ? [activeSection] : []),
  );
  // Every navigation reveals its section again, also one the visitor collapsed by hand.
  const place = `${slug}|${activeSection}`;
  const [seen, setSeen] = useState(place);
  if (place !== seen) {
    setSeen(place);
    if (activeSection) setOpenSections((s) => new Set(s).add(activeSection));
  }

  const toggle = (section: string) =>
    setOpenSections((s) => {
      const next = new Set(s);
      if (!next.delete(section)) next.add(section);
      return next;
    });

  // The section may still be animating open; wait for the final layout before scrolling.
  useEffect(() => {
    if (!slug) return;
    const timer = window.setTimeout(
      () =>
        document
          .querySelector<HTMLElement>("#help-sidebar [aria-current='page']")
          ?.scrollIntoView?.({ block: "nearest" }),
      260,
    );
    return () => window.clearTimeout(timer);
  }, [slug]);

  return (
    <nav aria-label={label} className="space-y-2">
      {groups.map((g) =>
        g.section ? (
          <Section
            key={g.section}
            group={g}
            slug={slug}
            open={openSections.has(g.section)}
            onToggle={() => toggle(g.section)}
          />
        ) : (
          <ul key="root" className="m-0 list-none space-y-0.5 p-0">
            {g.pages.map((m) => (
              <li key={m.slug}>
                <PageLink top slug={m.slug} title={m.title} current={m.slug === slug} />
              </li>
            ))}
          </ul>
        ),
      )}
    </nav>
  );
}
