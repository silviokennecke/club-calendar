import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Button, ErrorSummary, Field, TextInput } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { isEmailShape } from "@/lib/email";
import { requestPasswordReset } from "@/lib/passwordReset";
import { useFieldTouch } from "@/lib/useFieldTouch";

type Phase = "form" | "sent";

const EMAIL_ID = "forgot-email";

/**
 * Forgot password (design: ForgotPassword, AuthStates). The API answers the same whether or not the
 * address has an account (and also over its rate limit), so "Prüfe dein Postfach" never tells
 * whether an account exists. Only network / server errors show an error.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const form = useFieldTouch<"email">();
  // The API rejected the address although it passed the shape check.
  const [rejected, setRejected] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [failed, setFailed] = useState(0);
  const [loading, setLoading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const changedPhase = useRef(false);

  useEffect(() => {
    // Moving between the form and "check your inbox" replaces the page content: focus the new h1.
    if (changedPhase.current) headingRef.current?.focus();
  }, [phase]);

  const address = email.trim();
  const found = !address
    ? t("auth.register.emailMissing")
    : !isEmailShape(address) || rejected
      ? t("auth.emailInvalid")
      : "";
  const emailError = form.shown("email") ? found : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    form.submit();
    if (found) return;
    setFailed(0);
    setLoading(true);
    const result = await requestPasswordReset(address);
    setLoading(false);
    if (result === "invalid_email") {
      setRejected(true);
    } else if (result === "failed") {
      setFailed((n) => n + 1);
    } else {
      changedPhase.current = true;
      setPhase("sent");
    }
  }

  function again() {
    changedPhase.current = true;
    setPhase("form");
  }

  const footer = (
    <Link to="/login" className="ap-link">
      {t("auth.backToLogin")}
    </Link>
  );

  if (phase === "sent") {
    return (
      <AuthLayout
        icon="mail"
        title={t("auth.forgot.sentTitle")}
        headingRef={headingRef}
        intro={
          <span role="status">
            <Trans
              i18nKey="auth.forgot.sentText"
              values={{ email: email.trim() }}
              components={{ strong: <strong /> }}
            />
          </span>
        }
        footer={footer}
      >
        <p className="t-sm t-muted">{t("auth.forgot.sentHint")}</p>
        <Button type="button" variant="secondary" block onClick={again}>
          {t("auth.forgot.again")}
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.forgot.title")}
      intro={t("auth.forgot.intro")}
      headingRef={headingRef}
      footer={footer}
    >
      {failed > 0 && (
        <FocusBanner key={failed} tone="danger" title={t("auth.forgot.failedTitle")}>
          {t("auth.forgot.failedText")}
        </FocusBanner>
      )}
      <form
        className="ap-form"
        aria-label={t("auth.forgot.formLabel")}
        onSubmit={handleSubmit}
        noValidate
      >
        <ErrorSummary
          title={t("auth.forgot.errorTitle")}
          focusSignal={form.submits}
          errors={emailError ? [{ fieldId: EMAIL_ID, message: emailError }] : []}
        />
        <Field id={EMAIL_ID} label={t("auth.email")} required error={emailError}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setRejected(false);
            }}
            onBlur={() => form.touch("email")}
            autoComplete="email"
            inputMode="email"
            spellCheck={false}
          />
        </Field>
        <Button type="submit" block loading={loading}>
          {t("auth.forgot.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
