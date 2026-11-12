import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/shared";
import { useDisableMfa } from "@/lib/profile/mfa";
import { MfaActionDialog } from "./MfaActionDialog";

interface Props {
  open: boolean;
  onClose: () => void;
  hasTotp: boolean;
}

export function MfaDisableDialog({ open, onClose, hasTotp }: Props) {
  const { t } = useTranslation();
  const disable = useDisableMfa();
  return (
    <MfaActionDialog
      open={open}
      onClose={onClose}
      title={t("profile.mfa.disable.title")}
      submitLabel={t("profile.mfa.disable.confirm")}
      danger
      onSubmit={async () => {
        await disable.mutateAsync();
        toast.success(t("profile.mfa.disable.done"));
        onClose();
      }}
    >
      <p>{hasTotp ? t("profile.mfa.disable.textTotp") : t("profile.mfa.disable.text")}</p>
      <p className="t-sm">{t("profile.mfa.disable.passkeysStay")}</p>
      <p className="t-sm">{t("profile.mfa.disable.signOutOthers")}</p>
    </MfaActionDialog>
  );
}
