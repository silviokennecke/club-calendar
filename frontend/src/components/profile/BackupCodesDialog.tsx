import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { useRegenerateBackupCodes } from "@/lib/profile/mfa";
import { BackupCodesView } from "./BackupCodesView";
import { MfaActionDialog } from "./MfaActionDialog";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Regenerates the backup codes after the step-up confirmation and shows the new ones once. */
export function BackupCodesDialog({ open, onClose }: Props) {
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
    <MfaActionDialog
      open={open}
      onClose={close}
      title={t("profile.mfa.regenerate.title")}
      submitLabel={t("profile.mfa.regenerate.confirm")}
      onSubmit={async () => {
        const result = await regenerate.mutateAsync();
        setCodes(result.backupCodes);
      }}
    >
      <p>{t("profile.mfa.regenerate.text")}</p>
    </MfaActionDialog>
  );
}
