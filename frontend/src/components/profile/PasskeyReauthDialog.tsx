import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  CodeInput,
  Field,
  FormDialog,
  PasswordField,
  Skeleton,
} from "@/components/ui/shared";
import { apiErrorCode, apiPost } from "@/lib/api";
import { opaqueFailureKind, usePasswordProof } from "@/lib/opaque";
import { focusFirstInvalid } from "@/lib/focus";

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

const CODE_ID = "pr-pk-code";

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
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState<"idle" | "sending" | "sent">("idle");
  const [mailError, setMailError] = useState<string>();
  const proof = usePasswordProof("passkey-register");
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => focusFirstInvalid(formRef.current), [fieldError]);

  function close(next: boolean) {
    if (!next) {
      setPassword("");
      setCode("");
      setFieldError(undefined);
      setFailure(undefined);
      setMail("idle");
      setMailError(undefined);
    }
    onOpenChange(next);
  }

  async function sendCode() {
    setMail("sending");
    setMailError(undefined);
    try {
      await apiPost("/api/auth/webauthn/register/code", {});
      setMail("sent");
    } catch (error) {
      setMail("idle");
      setMailError(
        t(
          apiErrorCode(error) === "rate_limited"
            ? "profile.passkeys.reauth.rateLimited"
            : "profile.passkeys.reauth.codeFailed",
        ),
      );
    }
  }

  async function submit() {
    if (busy || hasPassword === undefined) return;
    setFieldError(undefined);
    setFailure(undefined);
    if (hasPassword && !password) {
      setFieldError(t("profile.account.passwordMissing"));
      return;
    }
    if (!hasPassword && !/^\d{6}$/.test(code)) {
      setFieldError(t("profile.passkeys.reauth.codeMissing"));
      return;
    }
    setBusy(true);
    try {
      const start = await apiPost<PasskeyRegistrationStart>(
        "/api/auth/webauthn/register/options",
        hasPassword ? await proof(password) : { code },
      );
      close(false);
      onConfirmed(start);
    } catch (error) {
      const errorCode = apiErrorCode(error);
      if (errorCode === "invalid_credentials") setFieldError(t("profile.account.wrongPassword"));
      else if (errorCode === "invalid_confirmation_code")
        setFieldError(t("profile.passkeys.reauth.wrongCode"));
      else if (errorCode === "rate_limited") setFailure(t("profile.passkeys.reauth.rateLimited"));
      else if (opaqueFailureKind(error) === "unsupported") setFailure(t("auth.opaqueUnsupported"));
      else if (opaqueFailureKind(error) === "unavailable") setFailure(t("auth.opaqueUnavailable"));
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
        {hasPassword === undefined && <Skeleton />}
        {hasPassword === true && (
          <PasswordField
            label={t("profile.passkeys.reauth.passwordLabel")}
            requiredLabel
            error={fieldError}
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {hasPassword === false && (
          <>
            <p className="t-sm">{t("profile.passkeys.reauth.codeText", { email })}</p>
            {mailError && <Banner tone="danger">{mailError}</Banner>}
            {mail === "sent" && (
              <Banner tone="success">{t("profile.passkeys.reauth.codeSent", { email })}</Banner>
            )}
            <div className="ap-actions">
              <Button
                variant="secondary"
                icon="mail"
                loading={mail === "sending"}
                onClick={() => void sendCode()}
              >
                {mail === "sent"
                  ? t("profile.passkeys.reauth.codeResend")
                  : t("profile.passkeys.reauth.codeSend")}
              </Button>
            </div>
            <Field
              group
              id={CODE_ID}
              label={t("profile.passkeys.reauth.codeLabel")}
              error={fieldError}
            >
              <CodeInput
                id={CODE_ID}
                label={t("profile.passkeys.reauth.codeLabel")}
                value={code}
                onChange={setCode}
                invalid={!!fieldError}
                describedBy={fieldError ? `${CODE_ID}-error` : undefined}
                disabled={busy}
              />
            </Field>
          </>
        )}
      </div>
    </FormDialog>
  );
}
