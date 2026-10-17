import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, ConfirmDialog, toast } from "@/components/ui/shared";
import { logoutEverywhere } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

/**
 * "Anmeldungen" panel: signs the account out everywhere (`POST /api/auth/logout-all`: access and refresh
 * tokens of all devices end), then this browser signs out locally and goes to the login page.
 */
export function SessionsSection() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  async function signOutEverywhere() {
    try {
      await logoutEverywhere();
    } catch {
      toast.error(t("profile.sessions.failed"));
      return;
    }
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-sessions">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-sessions">
            {t("profile.sessions.title")}
          </h2>
          <p>{t("profile.sessions.text")}</p>
        </div>
        <Button variant="secondary" icon="log-out" onClick={() => setOpen(true)}>
          {t("profile.sessions.action")}
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          icon="log-out"
          title={t("profile.sessions.confirmTitle")}
          description={t("profile.sessions.confirmText")}
          consequence={t("profile.sessions.consequence")}
          confirmLabel={t("profile.sessions.confirm")}
          onConfirm={signOutEverywhere}
        />
      </div>
    </section>
  );
}
