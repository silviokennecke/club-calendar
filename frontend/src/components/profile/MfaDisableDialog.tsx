import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/shared";
import { useDisableMfa } from "@/lib/profile/mfa";
import { MfaProofDialog } from "./MfaProofDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  hasPassword: boolean | undefined;
  email: string;
  hasTotp: boolean;
}

export function MfaDisableDialog({ open, onClose, hasPassword, email, hasTotp }: Props) {
  const { t } = useTranslation();
  const disable = useDisableMfa();
  return (
    <MfaProofDialog
      open={open}
      onClose={onClose}
      title={t("profile.mfa.disable.title")}
      submitLabel={t("profile.mfa.disable.confirm")}
      danger
      hasPassword={hasPassword}
      email={email}
      onSubmit={async (proof) => {
        await disable.mutateAsync(proof);
        toast.success(t("profile.mfa.disable.done"));
        onClose();
      }}
    >
      <p>{hasTotp ? t("profile.mfa.disable.textTotp") : t("profile.mfa.disable.text")}</p>
      <p className="t-sm">{t("profile.mfa.disable.passkeysStay")}</p>
      <p className="t-sm">{t("profile.mfa.disable.signOutOthers")}</p>
    </MfaProofDialog>
  );
}
