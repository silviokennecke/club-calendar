import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { legalTypeOf, useLegalDocument } from "@/lib/legal";
import { useExternalRedirect } from "@/lib/legal/useExternalRedirect";

/** Standalone page `/imprint`, `/privacy`, `/terms` (direct call, no background page). */
export default function LegalPage() {
  const { t } = useTranslation();
  const type = legalTypeOf(useLocation().pathname);
  const q = useLegalDocument(type);
  const redirecting = useExternalRedirect(q.data);
  return (
    <AuthLayout title={q.data?.title || t(`legal.${type}`)} wide>
      <LegalDocumentView document={q.data} loading={q.isPending || redirecting} error={q.error} />
    </AuthLayout>
  );
}
