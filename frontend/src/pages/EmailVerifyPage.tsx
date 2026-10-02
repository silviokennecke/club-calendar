import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Banner, Button, Field, LinkButton, TextInput, type Glyph } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { useResendVerification } from "@/components/auth/useResendVerification";

type Outcome = "success" | "expired" | "used" | "invalid";

const OUTCOME_ICON: Record<Outcome, { glyph: Glyph; tone: "brand" | "neutral" | "danger" }> = {
  success: { glyph: "check-circle", tone: "brand" },
  expired: { glyph: "clock", tone: "neutral" },
  used: { glyph: "link", tone: "neutral" },
  invalid: { glyph: "x-circle", tone: "danger" },
};

/**
 * /auth/verify-email serves two purposes:
 *  - with ?status=success|error&reason=... (backend redirect after clicking the mail link): result
 *  - without status (after registration, ?email=...): "please confirm your address" with resend.
 */
export default function EmailVerifyPage() {
  const [params] = useSearchParams();
  const status = params.get("status");
  const reason = params.get("reason");

  if (!status) return <PendingConfirmation initialEmail={params.get("email") ?? ""} />;

  const outcome: Outcome =
    status === "success"
      ? "success"
      : reason === "expired"
        ? "expired"
        : reason === "already_used"
          ? "used"
          : "invalid";
  return <Result outcome={outcome} />;
}

function Result({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const icon = OUTCOME_ICON[outcome];
  const toLogin = outcome === "success" || outcome === "used";
  return (
    <AuthLayout
      icon={icon.glyph}
      iconTone={icon.tone}
      title={t(`auth.verify.${outcome}.title`)}
      intro={t(`auth.verify.${outcome}.text`)}
    >
      <div className="ap-actions">
        {toLogin ? (
          <LinkButton to="/login">{t("auth.verify.toLogin")}</LinkButton>
        ) : (
          <LinkButton to="/auth/verify-email">{t("auth.verify.requestNew")}</LinkButton>
        )}
      </div>
    </AuthLayout>
  );
}

function PendingConfirmation({ initialEmail }: { initialEmail: string }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(initialEmail);
  const [emailError, setEmailError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const resend = useResendVerification();
  const known = initialEmail !== "";

  async function handleResend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) {
      setEmailError(t("auth.register.emailMissing"));
      return;
    }
    setEmailError("");
    setSubmitted(true);
    await resend.resend(email.trim());
  }

  const form = (
    <form className="ap-form" onSubmit={handleResend} noValidate>
      {!known && (
        <Field label={t("auth.email")} required error={emailError}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </Field>
      )}
      <Button type="submit" variant="secondary" block icon="send" loading={resend.loading}>
        {t("auth.verify.resend")}
      </Button>
    </form>
  );

  return (
    <AuthLayout
      wide
      icon="mail"
      title={t("auth.verify.pending.title")}
      intro={
        known ? (
          <Trans
            i18nKey="auth.verify.pending.textWithEmail"
            values={{ email }}
            components={{ strong: <strong /> }}
          />
        ) : (
          t("auth.verify.pending.textNoEmail")
        )
      }
      footer={
        <>
          {t("auth.verify.alreadyConfirmed")}{" "}
          <Link to="/login" className="ap-link">
            {t("auth.verify.toLogin")}
          </Link>
        </>
      }
    >
      <ol className="ap-ol">
        <li>{t("auth.verify.pending.step1")}</li>
        <li>{t("auth.verify.pending.step2")}</li>
        <li>{t("auth.verify.pending.step3")}</li>
      </ol>
      <Banner tone="info" title={t("auth.verify.pending.hintTitle")}>
        {t("auth.verify.pending.hintText")}
      </Banner>
      {submitted && resend.done && (
        <FocusBanner tone="success" title={t("auth.login.sentTitle")}>
          {t("auth.verify.pending.sent")}
        </FocusBanner>
      )}
      {form}
    </AuthLayout>
  );
}
