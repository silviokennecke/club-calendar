import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, CodeInput, Field, PasswordField, Skeleton } from "@/components/ui/shared";
import { apiErrorCode, apiPost } from "@/lib/api";
import { CODE_ENDPOINT, TEXT_PREFIX, type ReauthPurpose, type ReauthValue } from "./reauth";

interface ReauthFieldsProps {
  purpose?: ReauthPurpose;
  /** Undefined while the profile loads (the kind of proof is not known yet). */
  hasPassword: boolean | undefined;
  email: string;
  value: ReauthValue;
  onChange: (value: ReauthValue) => void;
  error?: string;
  busy?: boolean;
  /** Unique within the page; defaults to one per purpose. */
  idPrefix?: string;
}

/**
 * Proof of the account holder for sensitive actions: the password, or for an account without one a
 * 6-digit code mailed to its address (send button with its own error and "sent" state).
 */
export function ReauthFields({
  purpose = "step_up",
  hasPassword,
  email,
  value,
  onChange,
  error,
  busy,
  idPrefix = `pr-${purpose}`,
}: ReauthFieldsProps) {
  const { t } = useTranslation();
  const prefix = TEXT_PREFIX[purpose];
  const [mail, setMail] = useState<"idle" | "sending" | "sent">("idle");
  const [mailError, setMailError] = useState<string>();
  const codeId = `${idPrefix}-code`;

  async function sendCode() {
    setMail("sending");
    setMailError(undefined);
    try {
      await apiPost(CODE_ENDPOINT[purpose], {});
      setMail("sent");
    } catch (err) {
      setMail("idle");
      setMailError(
        t(apiErrorCode(err) === "rate_limited" ? `${prefix}.rateLimited` : `${prefix}.codeFailed`),
      );
    }
  }

  if (hasPassword === undefined) return <Skeleton />;
  if (hasPassword) {
    return (
      <PasswordField
        label={t(`${prefix}.passwordLabel`)}
        requiredLabel
        error={error}
        value={value.password}
        autoComplete="current-password"
        onChange={(e) => onChange({ ...value, password: e.target.value })}
      />
    );
  }
  return (
    <>
      <p className="t-sm">{t(`${prefix}.codeText`, { email })}</p>
      {mailError && <Banner tone="danger">{mailError}</Banner>}
      {mail === "sent" && <Banner tone="success">{t(`${prefix}.codeSent`, { email })}</Banner>}
      <div className="ap-actions">
        <Button
          variant="secondary"
          icon="mail"
          loading={mail === "sending"}
          onClick={() => void sendCode()}
        >
          {mail === "sent" ? t(`${prefix}.codeResend`) : t(`${prefix}.codeSend`)}
        </Button>
      </div>
      <Field group id={codeId} label={t(`${prefix}.codeLabel`)} error={error}>
        <CodeInput
          id={codeId}
          label={t(`${prefix}.codeLabel`)}
          value={value.code}
          onChange={(code) => onChange({ ...value, code })}
          invalid={!!error}
          describedBy={error ? `${codeId}-error` : undefined}
          disabled={busy}
        />
      </Field>
    </>
  );
}
