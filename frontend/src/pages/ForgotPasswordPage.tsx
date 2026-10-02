import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Banner, Button, Field, TextInput } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";

/**
 * Password reset. The backend has no reset endpoint yet (docs/redesign/BACKEND-GAPS.md),
 * so the form is shown but submitting is disabled with a "coming soon" notice.
 */
export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");

  return (
    <AuthLayout
      title={t("auth.forgot.title")}
      intro={t("auth.forgot.intro")}
      footer={
        <Link to="/login" className="ap-link">
          {t("auth.backToLogin")}
        </Link>
      }
    >
      <Banner tone="info" title={t("auth.forgot.soonTitle")} icon="clock">
        <span id="forgot-soon">{t("auth.forgot.soonText")}</span>
      </Banner>
      <form
        className="ap-form"
        aria-label={t("auth.forgot.formLabel")}
        onSubmit={(e) => e.preventDefault()}
        noValidate
      >
        <Field label={t("auth.email")} required>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </Field>
        <Button type="submit" block disabled aria-describedby="forgot-soon">
          {t("auth.forgot.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
