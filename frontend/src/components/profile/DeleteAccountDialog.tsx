import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { apiDelete, apiErrorCode, isStepUpCancelled } from "@/lib/api";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the account was deleted (sign out, leave the page). */
  onDeleted: () => void;
  /** Extra sentence under the last-member / last-admin errors (e.g. the consent gate: accept first). */
  blockedHint?: string;
}

const joinHint = (text: string, hint?: string) => (hint ? `${text} ${hint}` : text);

/**
 * Account deletion (AUTH-03). The identity proof is the step-up confirmation requested by the API layer
 * (password or mailed code, plus the MFA factor); the rate limit and the last-member guard are shown by `ApiError.code`.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  onDeleted,
  blockedHint,
}: DeleteAccountDialogProps) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  function close(next: boolean) {
    if (!next) {
      setFailure(undefined);
    }
    onOpenChange(next);
  }

  async function submit() {
    if (busy) return;
    setFailure(undefined);
    setBusy(true);
    try {
      await apiDelete("/api/auth/me");
    } catch (error) {
      if (isStepUpCancelled(error)) {
        setBusy(false);
        return;
      }
      const errorCode = apiErrorCode(error);
      if (isRateLimited(error)) setFailure(rateLimitText(t, error));
      else if (errorCode === "last_member_of_club")
        setFailure(joinHint(t("profile.danger.lastMemberOfClub"), blockedHint));
      else if (errorCode === "last_admin_of_club")
        setFailure(joinHint(t("profile.danger.lastAdminOfClub"), blockedHint));
      else setFailure(t("profile.danger.failed"));
      setBusy(false);
      return;
    }
    onDeleted();
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title={t("profile.danger.confirmTitle")}
      description={t("profile.danger.confirmText")}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="danger" icon="trash" loading={busy}>
            {t("profile.danger.confirm")}
          </Button>
        </>
      }
    >
      <div className="ap-stack">
        <p>{t("profile.danger.confirmText")}</p>
        <p className="t-sm">{t("profile.danger.consequence")}</p>
        <p className="t-sm">{t("profile.danger.exportHint")}</p>
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </FormDialog>
  );
}
