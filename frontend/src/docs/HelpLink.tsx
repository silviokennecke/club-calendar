import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useHelpUrl } from "./paths";
import type { DocSlug } from "./slugs.generated";

interface HelpLinkProps {
  page: DocSlug;
  anchor?: string;
  /** Link text; defaults to nothing, so pass an accessible label when empty. */
  children?: ReactNode;
  /** Open in a new tab (keeps a form or dialog alive). */
  newTab?: boolean;
  className?: string;
}

export function HelpLink({ page, anchor, children, newTab, className }: HelpLinkProps) {
  const to = useHelpUrl(page, anchor);
  return (
    <Link
      to={to}
      className={className ?? "ap-link"}
      {...(newTab ? { target: "_blank", rel: "noopener" } : {})}
    >
      {children}
    </Link>
  );
}
