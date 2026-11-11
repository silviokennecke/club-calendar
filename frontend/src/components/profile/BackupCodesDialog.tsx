import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { useRegenerateBackupCodes } from "@/lib/profile/mfa";
import { BackupCodesView } from "./BackupCodesView";
import { MfaProofDialog } from "./MfaProofDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  hasPassword: boolean | undefined;
  email: string;
}

/** Regenerates the backup codes after re-authentication and shows the new ones once. */
export function BackupCodesDialog({ open, onClose, hasPassword, email }: Props) {
  const { t } = useTranslation();
  const regenerate = useRegenerateBackupCodes();
  const [codes, setCodes] = useState<string[] | null>(null);

  function close() {
    setCodes(null);
    onClose();
  }

  if (codes) {
    return (
      <FormDialog
        open={open}
        onOpenChange={(next) => !next && close()}
        title={t("profile.mfa.regenerate.newTitle")}
        description={t("profile.mfa.regenerate.newTitle")}
        onSubmit={close}
        actions={<Button type="submit">{t("profile.mfa.regenerate.done")}</Button>}
      >
        <div className="ap-stack">
          <Banner tone="warning">{t("profile.mfa.regenerate.once")}</Banner>
          <BackupCodesView codes={codes} />
        </div>
      </FormDialog>
    );
  }

  return (
    <MfaProofDialog
      open={open}
      onClose={close}
      title={t("profile.mfa.regenerate.title")}
      submitLabel={t("profile.mfa.regenerate.confirm")}
      hasPassword={hasPassword}
      email={email}
      onSubmit={async (proof) => {
        const result = await regenerate.mutateAsync(proof);
        setCodes(result.backupCodes);
      }}
    >
      <p>{t("profile.mfa.regenerate.text")}</p>
    </MfaProofDialog>
  );
}
