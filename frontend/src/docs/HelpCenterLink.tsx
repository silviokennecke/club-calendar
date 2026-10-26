import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

/** Footer link to the help center (`/help`). */
export function HelpCenterLink() {
  const { t } = useTranslation();
  return (
    <Link to="/help" className="legal-link">
      {t("docs.footerLink")}
    </Link>
  );
}
