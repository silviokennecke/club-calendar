import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ConfirmDialog, toast } from "@/components/ui/shared";
import { useAuth } from "@/lib/auth-context";
import { dismissBackupCodeNotice, usePendingBackupCodeNotice } from "@/lib/backupCodeNotice";
import { useSignOutOtherSessions } from "@/lib/profile/mfa";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";

/**
 * Shown once after a sign-in with a backup code: MFA stays on, how many codes are left and the offer
 * to end the other sessions.
 */
export function BackupCodeNotice() {
  const pending = usePendingBackupCodeNotice();
  const { user } = useAuth();
  return pending && user?.id === pending.userId ? (
    <NoticeDialog remaining={pending.remaining} />
  ) : null;
}

function NoticeDialog({ remaining }: { remaining: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signOutOthers = useSignOutOtherSessions();

  async function confirm() {
    try {
      await signOutOthers.mutateAsync();
      toast.success(t("auth.backupNotice.signedOut"));
    } catch (err) {
      toast.error(
        isRateLimited(err) ? rateLimitText(t, err) : t("auth.backupNotice.signOutFailed"),
      );
    }
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) dismissBackupCodeNotice();
      }}
      tone="primary"
      icon="key"
      title={t("auth.backupNotice.title")}
      description={`${t("auth.backupNotice.text", { count: remaining })} ${t("auth.backupNotice.question")}`}
      consequence={remaining === 0 ? t("auth.backupNotice.none") : undefined}
      confirmLabel={t("auth.backupNotice.signOutOthers")}
      cancelLabel={t("auth.backupNotice.keep")}
      onConfirm={confirm}
      alternative={{
        label: t("auth.backupNotice.newCodes"),
        onConfirm: () => navigate("/profile#pr-mfa"),
      }}
    />
  );
}
