import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { helpPath } from "@/docs/paths";

export function HelpFooterLink() {
  const { t } = useTranslation();
  return (
    <Link to={helpPath("publishing/subscribe")} className="legal-link">
      {t("shell.helpSubscribe")}
    </Link>
  );
}
