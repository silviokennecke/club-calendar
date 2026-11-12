import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/shared";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";
import { useAuth } from "@/lib/auth-context";

export function DangerSection() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);

  function accountDeleted() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <section className="ap-panel ap-panel--danger" aria-labelledby="pr-danger">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-danger">
            {t("profile.danger.title")}
          </h2>
          <p>{t("profile.danger.text")}</p>
        </div>
        <Button variant="danger" icon="trash" onClick={() => setDeleteOpen(true)}>
          {t("profile.danger.action")}
        </Button>
        <DeleteAccountDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={accountDeleted}
        />
      </div>
    </section>
  );
}
