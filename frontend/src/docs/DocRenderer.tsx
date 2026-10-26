import { Children, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "@/components/ui/shared";
import { docPath } from "./paths";
import type { DocNode } from "./types";

type El = Extract<DocNode, { type: "element" }>;

const CALLOUTS: Record<string, { icon: Glyph; box: string }> = {
  note: { icon: "info", box: "border-border bg-surface-sunken" },
  tip: { icon: "check-circle", box: "border-brand bg-brand-soft" },
  warning: { icon: "alert", box: "border-danger bg-danger-soft" },
};

const HEADING = {
  h1: "t-h1 mt-0 mb-4",
  h2: "t-h2 mt-10 mb-3",
  h3: "t-h3 mt-8 mb-2",
  h4: "t-h3 mt-6 mb-2",
} as const;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** `help:slug#anchor` target of an `a[data-help]` as a router path. */
function helpTarget(ref: string): string {
  const [slug, anchor] = ref.split("#");
  return docPath(slug || "index", anchor);
}

function Heading({ node, children }: { node: El; children: ReactNode }) {
  const { t } = useTranslation();
  const Tag = node.tag as keyof typeof HEADING;
  const id = str(node.props.id);
  return (
    <Tag id={id} className={cn(HEADING[Tag], "group scroll-mt-24")}>
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label={t("docs.anchorLabel")}
          className="text-ink-muted ml-2 no-underline opacity-0 group-hover:opacity-100 focus:opacity-100"
        >
          #
        </a>
      )}
    </Tag>
  );
}

function Callout({ kind, children }: { kind: string; children: ReactNode }) {
  const { t } = useTranslation();
  const c = CALLOUTS[kind] ?? CALLOUTS.note;
  return (
    <div
      role="note"
      data-callout={kind}
      className={cn("text-ink my-5 flex gap-3 rounded-lg border-l-4 p-4", c.box)}
    >
      <Icon glyph={c.icon} size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 [&>*:last-child]:mb-0 [&>:nth-child(2)]:mt-0">
        <span className="ap-sr">{t(`docs.callout.${kind in CALLOUTS ? kind : "note"}`)}: </span>
        {children}
      </div>
    </div>
  );
}

function renderEl(node: El, key: number): ReactNode {
  const p = node.props;
  const kids = node.children.map(renderNode);
  switch (node.tag) {
    case "div":
      return p["data-callout"] !== undefined ? (
        <Callout key={key} kind={String(p["data-callout"])}>
          {kids}
        </Callout>
      ) : (
        <div key={key}>{kids}</div>
      );
    case "h1":
    case "h2":
    case "h3":
    case "h4":
      return (
        <Heading key={key} node={node}>
          {kids}
        </Heading>
      );
    case "p":
      return (
        <p key={key} className="t-body my-4 leading-7">
          {kids}
        </p>
      );
    case "a": {
      const help = str(p["data-help"]);
      if (help !== undefined) {
        return (
          <Link key={key} to={helpTarget(help)} className="ap-link">
            {kids}
          </Link>
        );
      }
      const href = str(p.href);
      const external = href !== undefined && /^[a-z][a-z0-9+.-]*:/i.test(href);
      return (
        <a
          key={key}
          href={href}
          className="ap-link"
          {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {kids}
        </a>
      );
    }
    case "img":
      return (
        <img
          key={key}
          src={str(p.src)}
          alt={str(p.alt) ?? ""}
          loading="lazy"
          decoding="async"
          className="border-border my-5 h-auto max-w-full rounded-lg border"
        />
      );
    case "ul":
      return (
        <ul key={key} className="my-4 list-disc space-y-1 pl-6">
          {kids}
        </ul>
      );
    case "ol":
      return (
        <ol
          key={key}
          start={typeof p.start === "number" ? p.start : undefined}
          className="my-4 list-decimal space-y-1 pl-6"
        >
          {kids}
        </ol>
      );
    case "li":
      return (
        <li key={key} className="t-body leading-7 [&>p]:my-1">
          {kids}
        </li>
      );
    case "blockquote":
      return (
        <blockquote key={key} className="border-border-strong text-ink-muted my-5 border-l-4 pl-4">
          {kids}
        </blockquote>
      );
    case "pre":
      return (
        <pre
          key={key}
          tabIndex={0}
          className="bg-surface-sunken my-5 overflow-x-auto rounded-lg p-4 text-sm [&_code]:bg-transparent [&_code]:p-0"
        >
          {kids}
        </pre>
      );
    case "code":
      return (
        <code key={key} className="ap-code bg-surface-sunken rounded px-1 py-0.5">
          {kids}
        </code>
      );
    case "table":
      return (
        <div key={key} className="my-5 overflow-x-auto" tabIndex={0}>
          <table className="w-full border-collapse text-left text-sm">{kids}</table>
        </div>
      );
    case "thead":
    case "tbody":
    case "tr": {
      const Tag = node.tag;
      return <Tag key={key}>{kids}</Tag>;
    }
    case "th":
      return (
        <th key={key} scope="col" className="border-border-strong border-b-2 px-3 py-2 font-bold">
          {kids}
        </th>
      );
    case "td":
      return (
        <td key={key} className="border-border border-b px-3 py-2 align-top">
          {kids}
        </td>
      );
    case "hr":
      return <hr key={key} className="border-border my-8" />;
    case "strong":
    case "em":
    case "del":
    case "br": {
      const Tag = node.tag;
      return Tag === "br" ? <br key={key} /> : <Tag key={key}>{kids}</Tag>;
    }
    default:
      // Unknown tags render their content only; nothing from the tree is injected as markup.
      return <span key={key}>{Children.toArray(kids)}</span>;
  }
}

function renderNode(node: DocNode, key: number): ReactNode {
  return node.type === "text" ? node.value : renderEl(node, key);
}

/** Renders the compiled doc tree as React elements (no raw HTML). */
export function DocRenderer({ tree }: { tree: DocNode }) {
  return <div className="doc-content max-w-none">{renderNode(tree, 0)}</div>;
}
