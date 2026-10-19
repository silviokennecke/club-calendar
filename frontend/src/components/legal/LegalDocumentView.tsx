import { useTranslation } from "react-i18next";
import { apiErrorStatus } from "@/lib/api";
import type { LegalDocument } from "@/lib/legal";
import { Skeleton } from "@/components/ui/shared";

interface LegalDocumentViewProps {
  /** Loaded document (undefined while loading or failed). */
  document: LegalDocument | undefined;
  loading?: boolean;
  error?: unknown;
}

/**
 * Body of a legal document: the backend renders the Markdown to sanitized HTML (`html_input: escape`),
 * shown inside `.legal-prose`. Loading, "not provided" (404) and error states. Reusable for any version.
 */
export function LegalDocumentView({ document, loading, error }: LegalDocumentViewProps) {
  const { t, i18n } = useTranslation();
  if (loading) {
    return (
      <div className="ap-stack ap-stack--sm" aria-busy="true" role="status">
        <span className="sr-only">{t("legal.loading")}</span>
        <Skeleton style={{ height: 24, width: "60%" }} />
        <Skeleton style={{ height: 16 }} />
        <Skeleton style={{ height: 16 }} />
        <Skeleton style={{ height: 16, width: "80%" }} />
      </div>
    );
  }
  if (document) {
    return (
      <div className="ap-stack ap-stack--sm">
        <p className="t-sm t-muted">
          {t("legal.publishedAt", {
            date: new Date(document.publishedAt).toLocaleDateString(i18n.language),
          })}
        </p>
        <div className="legal-prose" dangerouslySetInnerHTML={{ __html: document.html }} />
      </div>
    );
  }
  const status = apiErrorStatus(error);
  return (
    <p className="t-body t-muted" role={status === 404 ? undefined : "alert"}>
      {status === 404 ? t("legal.notProvided") : t("legal.loadFailed")}
    </p>
  );
}
