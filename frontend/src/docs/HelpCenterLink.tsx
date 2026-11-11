import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useContextHelpUrl } from "./contextHelp";

interface HelpCenterLinkProps {
  /** Overrides the target (default: the help page of the current screen). */
  to?: string;
  /** Overrides the label (default "Help"). */
  label?: string;
  className?: string;
  /** Content before the label (an icon). */
  children?: ReactNode;
}

/** Help link of the shell and the page footers: context-sensitive, always in a new tab. */
export function HelpCenterLink({
  to,
  label,
  className = "legal-link",
  children,
}: HelpCenterLinkProps) {
  const { t } = useTranslation();
  const contextUrl = useContextHelpUrl();
  return (
    <Link to={to ?? contextUrl} className={className} target="_blank" rel="noopener noreferrer">
      {children}
      {label ?? t("docs.footerLink")}
      <span className="ap-sr"> ({t("docs.opensInNewTab")})</span>
    </Link>
  );
}
