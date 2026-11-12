import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog, Skeleton, toast } from "@/components/ui/shared";
import { useEnablePasskeyEnforcement, useStartPasskeyEnforcement } from "@/lib/profile/mfa";
import { BackupCodesView } from "./BackupCodesView";
import { MfaActionDialog } from "./MfaActionDialog";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Setup {
  setupToken: string;
  backupCodes: string[];
}

/** Enforce MFA with the existing passkeys: backup codes (acknowledged), then the step-up confirmation. */
export function MfaEnforceDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const start = useStartPasskeyEnforcement();
  const enable = useEnablePasskeyEnforcement();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [failed, setFailed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [proofStep, setProofStep] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setFailed(false);
    start
      .mutateAsync()
      .then((s) => live && setSetup(s))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    setSetup(null);
    setAcknowledged(false);
    setProofStep(false);
    onClose();
  }

  if (proofStep && setup) {
    return (
      <MfaActionDialog
        open={open}
        onClose={close}
        title={t("profile.mfa.enforce.title")}
        submitLabel={t("profile.mfa.enforce.confirm")}
        onSubmit={async () => {
          await enable.mutateAsync(setup);
          toast.success(t("profile.mfa.enforce.done"));
          close();
        }}
      >
        <p>{t("profile.mfa.enforce.proofText")}</p>
      </MfaActionDialog>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={t("profile.mfa.enforce.title")}
      description={t("profile.mfa.enforce.title")}
      onSubmit={() => acknowledged && setup && setProofStep(true)}
      actions={
        <>
          <Button variant="secondary" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!setup || !acknowledged}>
            {t("profile.mfa.enforce.next")}
          </Button>
        </>
      }
    >
      <div className="ap-stack">
        <p>{t("profile.mfa.enforce.text")}</p>
        {failed && <Banner tone="danger">{t("profile.mfa.failed")}</Banner>}
        {!setup && !failed && <Skeleton style={{ display: "block", height: 120 }} />}
        {setup && (
          <>
            <Banner tone="warning">{t("profile.mfa.regenerate.once")}</Banner>
            <BackupCodesView codes={setup.backupCodes} />
            <label className="ap-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>{t("profile.mfa.enforce.acknowledge")}</span>
            </label>
          </>
        )}
      </div>
    </FormDialog>
  );
}
