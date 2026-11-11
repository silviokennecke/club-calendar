import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { apiErrorCode, apiPost } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";
import { ReauthFields } from "./ReauthFields";
import { emptyReauth, reauthBody, reauthFieldError, reauthMissing } from "./reauth";

export interface PasskeyRegistrationStart {
  options: unknown;
  challengeToken: string;
}

interface PasskeyReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while the profile loads (the kind of confirmation is not known yet). */
  hasPassword: boolean | undefined;
  email: string;
  /** Called with the registration options the server issues after the proof. */
  onConfirmed: (start: PasskeyRegistrationStart) => void;
}

/**
 * Proof of the account holder before a passkey is registered (L7): the password, or for an account
 * without one a 6-digit code mailed to its address. The server hands out the registration options only
 * after a valid proof; errors are matched by `ApiError.code`.
 */
export function PasskeyReauthDialog({
  open,
  onOpenChange,
  hasPassword,
  email,
  onConfirmed,
}: PasskeyReauthDialogProps) {
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
    const missing = reauthMissing(proof, hasPassword, "passkey", t);
    if (missing) {
      setFieldError(missing);
      return;
    }
    setBusy(true);
    try {
      const start = await apiPost<PasskeyRegistrationStart>(
        "/api/auth/webauthn/register/options",
        reauthBody(proof, hasPassword, "code"),
      );
      close(false);
      onConfirmed(start);
    } catch (error) {
      const errorCode = apiErrorCode(error);
      const wrong = reauthFieldError(error, "passkey", t);
      if (wrong) setFieldError(wrong);
      else if (errorCode === "rate_limited") setFailure(t("profile.passkeys.reauth.rateLimited"));
      else setFailure(t("profile.passkeys.reauth.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={close}
      title={t("profile.passkeys.reauth.title")}
      description={t("profile.passkeys.reauth.text")}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button variant="secondary" onClick={() => close(false)} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" icon="shield" loading={busy} disabled={hasPassword === undefined}>
            {t("profile.passkeys.reauth.confirm")}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="ap-stack">
        <p>{t("profile.passkeys.reauth.text")}</p>
        {failure && <Banner tone="danger">{failure}</Banner>}
        <ReauthFields
          key={fieldsKey}
          purpose="passkey"
          idPrefix="pr-pk"
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
