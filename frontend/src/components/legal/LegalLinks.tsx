import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { openModalState } from "@/lib/modalRoutes";
import { LEGAL_TYPES, legalPath, useLegalOverview } from "@/lib/legal";

/**
 * Imprint · Privacy · Terms. A link opens the document as a routed modal above the current page; a
 * type without a published document (or while the list loads / failed) is muted, non-interactive text.
 */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { data } = useLegalOverview();
  return (
    <nav
      className={className ? `legal-links ${className}` : "legal-links"}
      aria-label={t("legal.nav")}
    >
      {LEGAL_TYPES.map((type, i) => (
        <Fragment key={type}>
          {i > 0 && (
            <span aria-hidden="true" className="legal-links-sep">
              ·
            </span>
          )}
          {data?.[type] ? (
            <Link to={legalPath(type)} state={openModalState(location)} className="legal-link">
              {t(`legal.${type}`)}
            </Link>
          ) : (
            <span className="legal-link legal-link--off" aria-disabled="true">
              {t(`legal.${type}`)}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
