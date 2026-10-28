import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { openModalState } from "@/lib/modalRoutes";
import { Modal } from "@/components/ui/shared";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import {
  LEGAL_TYPES,
  externalLinkProps,
  legalPath,
  useLegalDocument,
  useLegalOverview,
  type LegalType,
} from "@/lib/legal";

/** Dialog without navigation: the address (with a feed secret) never reaches history state. */
function LocalLegalModal({ type, onClose }: { type: LegalType; onClose: () => void }) {
  const { t } = useTranslation();
  const q = useLegalDocument(type);
  return (
    <Modal
      size="wide"
      title={q.data?.title || t(`legal.${type}`)}
      closeLabel={t("legal.close")}
      onClose={onClose}
      busy={q.isPending}
    >
      <LegalDocumentView document={q.data} loading={q.isPending} error={q.error} />
    </Modal>
  );
}

/**
 * Imprint · Privacy · Terms. An externally linked document is a plain link (same tab); other links open the document as a routed modal above the current page.
 * Only renders types that have a published document. `trailing` (e.g. the help link) follows them in the same list; without any document it renders alone.
 * Returns null when there is nothing to render (while loading, on error, or none published).
 */
export function LegalLinks({ className, trailing }: { className?: string; trailing?: ReactNode }) {
  const { t } = useTranslation();
  const location = useLocation();
  const { data } = useLegalOverview();
  const [open, setOpen] = useState<LegalType | null>(null);
  // A feed address with a secret must not be copied into history state: open a local dialog instead.
  const secretFeed =
    location.pathname.startsWith("/feed/") && !!new URLSearchParams(location.search).get("secret");

  // Filter to only available types (those with a document or external URL)
  const availableTypes = LEGAL_TYPES.filter((type) => data?.[type]);

  // Return nothing while loading, on error, or when no types are available
  if (!data || availableTypes.length === 0) {
    return trailing ?? null;
  }

  return (
    <nav
      className={className ? `legal-links ${className}` : "legal-links"}
      aria-label={t("legal.nav")}
    >
      {availableTypes.map((type) =>
        data[type]?.url ? (
          <a key={type} {...externalLinkProps(data[type].url, false)} className="legal-link">
            {t(`legal.${type}`)}
          </a>
        ) : secretFeed ? (
          <button key={type} type="button" className="legal-link" onClick={() => setOpen(type)}>
            {t(`legal.${type}`)}
          </button>
        ) : (
          <Link
            key={type}
            to={legalPath(type)}
            state={openModalState(location)}
            className="legal-link"
          >
            {t(`legal.${type}`)}
          </Link>
        ),
      )}
      {trailing}
      {open && <LocalLegalModal type={open} onClose={() => setOpen(null)} />}
    </nav>
  );
}
