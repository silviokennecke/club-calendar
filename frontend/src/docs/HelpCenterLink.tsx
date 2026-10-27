import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

interface HelpCenterLinkProps {
  /** Overrides the target (default `/help`), e.g. a direct article. */
  to?: string;
  /** Overrides the label (default "Help"). */
  label?: string;
}

/** The single help link in page footers: the help center, or a given article. */
export function HelpCenterLink({ to = "/help", label }: HelpCenterLinkProps) {
  const { t } = useTranslation();
  return (
    <Link to={to} className="legal-link">
      {label ?? t("docs.footerLink")}
    </Link>
  );
}
