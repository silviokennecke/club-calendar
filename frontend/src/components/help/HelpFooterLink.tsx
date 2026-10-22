import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export function HelpFooterLink() {
  const { t } = useTranslation();
  return (
    <Link to="/help/subscribe" className="legal-link">
      {t("shell.helpSubscribe")}
    </Link>
  );
}
