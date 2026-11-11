import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { apiDelete, apiErrorCode } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";
import { ReauthFields } from "./ReauthFields";
import { emptyReauth, reauthBody, reauthFieldError, reauthMissing } from "./reauth";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while the profile loads (the kind of confirmation is not known yet). */
  hasPassword: boolean | undefined;
  email: string;
  /** Called after the account was deleted (sign out, leave the page). */
  onDeleted: () => void;
  /** Extra sentence under the last-member / last-admin errors (e.g. the consent gate: accept first). */
  blockedHint?: string;
}

const joinHint = (text: string, hint?: string) => (hint ? `${text} ${hint}` : text);

/**
 * Account deletion with re-authentication (AUTH-03): an account with a password confirms with it; an
 * account without one (SSO-only, passkey-only) with a 6-digit code mailed to its address. Wrong
 * credentials, the rate limit and the last-member guard are shown by `ApiError.code`.
 */
export function DeleteAccountDialog({
  open,
  onOpenChange,
  hasPassword,
  email,
  onDeleted,
  blockedHint,
}: DeleteAccountDialogProps) {
  const { t } = useTranslation();
  const [proof, setProof] = useState(emptyReauth);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => focusFirstInvalid(formRef.current), [fieldError]);

  function close(next: boolean) {
    if (!next) {
      setProof(emptyReauth);
      setFieldsKey((k) => k + 1);
      setFieldError(undefined);
      setFailure(undefined);
    }
    onOpenChange(next);
  }

  async function submit() {
    if (busy || hasPassword === undefined) return;
    setFieldError(undefined);
    setFailure(undefined);
    const missing = reauthMissing(proof, hasPassword, "delete", t);
    if (missing) {
      setFieldError(missing);
      return;
    }
    setBusy(true);
    try {
      await apiDelete("/api/auth/me", reauthBody(proof, hasPassword, "code"));
    } catch (error) {
      const errorCode = apiErrorCode(error);
      const wrong = reauthFieldError(error, "delete", t);
      if (wrong) setFieldError(wrong);
      else if (errorCode === "rate_limited") setFailure(t("profile.danger.rateLimited"));
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
          <Button
            type="submit"
            variant="danger"
            icon="trash"
            loading={busy}
            disabled={hasPassword === undefined}
          >
            {t("profile.danger.confirm")}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="ap-stack">
        <p>{t("profile.danger.confirmText")}</p>
        <p className="t-sm">{t("profile.danger.consequence")}</p>
        {failure && <Banner tone="danger">{failure}</Banner>}
        <ReauthFields
          key={fieldsKey}
          purpose="delete"
          idPrefix="pr-del"
          hasPassword={hasPassword}
          email={email}
          value={proof}
          onChange={setProof}
          error={fieldError}
          busy={busy}
        />
      </div>
    </FormDialog>
  );
}
