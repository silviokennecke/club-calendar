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
import { apiDelete, apiErrorCode, apiPost } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Undefined while the profile loads (the kind of confirmation is not known yet). */
  hasPassword: boolean | undefined;
  email: string;
  /** Called after the account was deleted (sign out, leave the page). */
  onDeleted: () => void;
}

const CODE_ID = "pr-del-code";

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
}: DeleteAccountDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState<"idle" | "sending" | "sent">("idle");
  const [mailError, setMailError] = useState<string>();
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
      await apiPost("/api/auth/delete-account/code", {});
      setMail("sent");
    } catch (error) {
      setMail("idle");
      setMailError(
        t(
          apiErrorCode(error) === "rate_limited"
            ? "profile.danger.rateLimited"
            : "profile.danger.codeFailed",
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
      setFieldError(t("profile.danger.codeMissing"));
      return;
    }
    setBusy(true);
    try {
      await apiDelete("/api/auth/me", hasPassword ? { password } : { code });
    } catch (error) {
      const errorCode = apiErrorCode(error);
      if (errorCode === "invalid_credentials") setFieldError(t("profile.account.wrongPassword"));
      else if (errorCode === "invalid_confirmation_code")
        setFieldError(t("profile.danger.wrongCode"));
      else if (errorCode === "rate_limited") setFailure(t("profile.danger.rateLimited"));
      else if (errorCode === "last_member_of_club")
        setFailure(t("profile.danger.lastMemberOfClub"));
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
        {hasPassword === undefined && <Skeleton />}
        {hasPassword === true && (
          <PasswordField
            label={t("profile.danger.passwordLabel")}
            requiredLabel
            error={fieldError}
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {hasPassword === false && (
          <>
            <p className="t-sm">{t("profile.danger.codeText", { email })}</p>
            {mailError && <Banner tone="danger">{mailError}</Banner>}
            {mail === "sent" && (
              <Banner tone="success">{t("profile.danger.codeSent", { email })}</Banner>
            )}
            <div className="ap-actions">
              <Button
                variant="secondary"
                icon="mail"
                loading={mail === "sending"}
                onClick={() => void sendCode()}
              >
                {mail === "sent" ? t("profile.danger.codeResend") : t("profile.danger.codeSend")}
              </Button>
            </div>
            <Field group id={CODE_ID} label={t("profile.danger.codeLabel")} error={fieldError}>
              <CodeInput
                id={CODE_ID}
                label={t("profile.danger.codeLabel")}
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
