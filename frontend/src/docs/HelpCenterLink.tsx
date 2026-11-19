import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useContextHelpUrl } from "./contextHelp";

interface HelpCenterLinkProps extends Omit<
  ComponentPropsWithoutRef<typeof Link>,
  "to" | "children" | "target" | "rel"
> {
  /** Overrides the target (default: the help page of the current screen). */
  to?: string;
  /** Overrides the label (default "Help"). */
  label?: string;
  className?: string;
  /** Content before the label (an icon). */
  children?: ReactNode;
  /** Keeps the label for screen readers only (icon-only rail). */
  hideLabel?: boolean;
}

/** Help link of the shell and the page footers: context-sensitive, always in a new tab. */
export const HelpCenterLink = forwardRef<HTMLAnchorElement, HelpCenterLinkProps>(
  function HelpCenterLink(
    { to, label, className = "legal-link", children, hideLabel, ...rest },
    ref,
  ) {
    const { t } = useTranslation();
    const contextUrl = useContextHelpUrl();
    return (
      <Link
        {...rest}
        ref={ref}
        to={to ?? contextUrl}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
        <span className={hideLabel ? "ap-sr" : undefined}>{label ?? t("docs.footerLink")}</span>
        <span className="ap-sr"> ({t("docs.opensInNewTab")})</span>
      </Link>
    );
  },
);
