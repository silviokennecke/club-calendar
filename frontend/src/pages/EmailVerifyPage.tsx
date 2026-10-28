import { Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LinkButton, type Glyph } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";

type Outcome = "emailChanged" | "emailTaken" | "changeExpired" | "changeInvalid";

const OUTCOME_ICON: Record<Outcome, { glyph: Glyph; tone: "brand" | "neutral" | "danger" }> = {
  emailChanged: { glyph: "check-circle", tone: "brand" },
  emailTaken: { glyph: "x-circle", tone: "danger" },
  changeExpired: { glyph: "clock", tone: "neutral" },
  changeInvalid: { glyph: "x-circle", tone: "danger" },
};

/**
 * /auth/verify-email is the redirect target of the backend's e-mail CHANGE link
 * (`?status=email_changed`, or `?status=error&reason=…&flow=email_change`). After an address change all
 * sessions have ended: sign in again. Confirming a new account works with a code at /verify-email (signed-in
 * restricted session); everything else sent here goes there.
 */
export default function EmailVerifyPage() {
  const [params] = useSearchParams();
  const status = params.get("status");
  const reason = params.get("reason");

  let outcome: Outcome;
  if (status === "email_changed") outcome = "emailChanged";
  else if (params.get("flow") === "email_change") {
    outcome =
      reason === "email_taken"
        ? "emailTaken"
        : reason === "expired"
          ? "changeExpired"
          : "changeInvalid";
  } else {
    return <Navigate to="/verify-email" replace />;
  }
  return <Result outcome={outcome} />;
}

function Result({ outcome }: { outcome: Outcome }) {
  const { t } = useTranslation();
  const icon = OUTCOME_ICON[outcome];
  return (
    <AuthLayout
      icon={icon.glyph}
      iconTone={icon.tone}
      title={t(`auth.verify.${outcome}.title`)}
      intro={t(`auth.verify.${outcome}.text`)}
    >
      <div className="ap-actions">
        {outcome === "emailChanged" ? (
          <LinkButton to="/login">{t("auth.verify.toLogin")}</LinkButton>
        ) : (
          <LinkButton to="/profile">{t("auth.verify.toProfile")}</LinkButton>
        )}
      </div>
    </AuthLayout>
  );
}
