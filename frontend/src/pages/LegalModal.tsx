import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Modal } from "@/components/ui/shared";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { legalTypeOf, useLegalDocument } from "@/lib/legal";
import { useModalNav } from "@/lib/useModalNav";

/** `/imprint`, `/privacy`, `/terms` as a dialog above the page that opened it (signed in or out). */
export default function LegalModal() {
  const { t } = useTranslation();
  const { close } = useModalNav();
  const type = legalTypeOf(useLocation().pathname);
  const q = useLegalDocument(type);
  return (
    <Modal
      size="wide"
      title={q.data?.title || t(`legal.${type}`)}
      closeLabel={t("legal.close")}
      onClose={close}
      busy={q.isPending}
    >
      <LegalDocumentView document={q.data} loading={q.isPending} error={q.error} />
    </Modal>
  );
}
