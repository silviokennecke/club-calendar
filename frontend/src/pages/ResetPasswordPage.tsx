import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, ErrorSummary, LinkButton, PasswordField } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { passwordProblem } from "@/lib/password";
import { resetPasswordSecure } from "@/lib/passwordReset";
import { fetchRegistrationInfo } from "@/lib/registration";
import { useMetaTag } from "@/lib/useMetaTag";

type Phase = "form" | "invalid" | "done";

const PASSWORD_ID = "reset-password";
const CONFIRM_ID = "reset-confirm";

interface FieldErrors {
  password?: string;
  confirm?: string;
}

/**
 * /reset-password?token=… (link from the reset mail). The token is read once and removed from the
 * address right away (replace: not in the history, not in a copied URL); the page title never contains
 * it and no Referer leaves the page. Unknown, used and expired links look the same (the API does not
 * tell them apart): "invalid" with a way to request a new link.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [token] = useState(() => params.get("token") ?? "");
  const [phase, setPhase] = useState<Phase>(token ? "form" : "invalid");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failed, setFailed] = useState(0);
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const changedPhase = useRef(false);

  useMetaTag("referrer", "no-referrer");

  useEffect(() => {
    if (params.has("token")) navigate({ search: "" }, { replace: true });
  }, [params, navigate]);

  useEffect(() => {
    if (changedPhase.current) headingRef.current?.focus();
  }, [phase]);

  function show(next: Phase) {
    changedPhase.current = true;
    setPhase(next);
  }

  function reject(found: FieldErrors) {
    setErrors(found);
    const first = found.password ? PASSWORD_ID : found.confirm ? CONFIRM_ID : null;
    if (first) document.getElementById(first)?.focus();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFailed(0);
    setUnsupported(false);
    const found: FieldErrors = {};
    const problem = passwordProblem(password);
    if (problem) found.password = t(`auth.reset.password.${problem}`);
    else if (confirm !== password) found.confirm = t("auth.register.confirmMismatchField");
    setErrors(found);
    if (Object.keys(found).length > 0) {
      reject(found);
      return;
    }

    setLoading(true);
    const info = await fetchRegistrationInfo(queryClient);
    const result = await resetPasswordSecure(token, password, info?.opaqueEnabled);
    setLoading(false);
    if (result === "done") show("done");
    else if (result === "invalid_token") show("invalid");
    else if (result === "unsupported") {
      setUnsupported(true);
      setFailed((n) => n + 1);
    } else if (result === "weak_password") reject({ password: t("auth.reset.password.short") });
    else setFailed((n) => n + 1);
  }

  if (phase === "invalid") {
    return (
      <AuthLayout
        icon="x-circle"
        iconTone="danger"
        title={t("auth.reset.invalidTitle")}
        intro={t("auth.reset.invalidText")}
        headingRef={headingRef}
        footer={
          <Link to="/login" className="ap-link">
            {t("auth.backToLogin")}
          </Link>
        }
      >
        <div className="ap-actions">
          <LinkButton to="/forgot-password">{t("auth.reset.requestNew")}</LinkButton>
        </div>
      </AuthLayout>
    );
  }

  if (phase === "done") {
    return (
      <AuthLayout icon="check-circle" title={t("auth.reset.doneTitle")} headingRef={headingRef}>
        <FocusBanner tone="success" title={t("auth.reset.doneBannerTitle")}>
          {t("auth.reset.doneText")}
        </FocusBanner>
        <div className="ap-actions">
          <LinkButton to="/login" replace>
            {t("auth.reset.toLogin")}
          </LinkButton>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("auth.reset.title")}
      intro={t("auth.reset.intro")}
      headingRef={headingRef}
      footer={
        <Link to="/login" className="ap-link">
          {t("auth.backToLogin")}
        </Link>
      }
    >
      {failed > 0 && (
        <FocusBanner key={failed} tone="danger" title={t("auth.reset.failedTitle")}>
          {t(unsupported ? "auth.opaqueUnsupported" : "auth.reset.failedText")}
        </FocusBanner>
      )}
      <form
        className="ap-form"
        aria-label={t("auth.reset.formLabel")}
        onSubmit={handleSubmit}
        noValidate
      >
        <ErrorSummary
          title={t("auth.reset.errorTitle")}
          errors={[
            ...(errors.password ? [{ fieldId: PASSWORD_ID, message: errors.password }] : []),
            ...(errors.confirm ? [{ fieldId: CONFIRM_ID, message: errors.confirm }] : []),
          ]}
        />
        <PasswordField
          id={PASSWORD_ID}
          label={t("auth.reset.newPassword")}
          requiredLabel
          hint={t("auth.register.passwordHint")}
          error={errors.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordField
          id={CONFIRM_ID}
          label={t("auth.register.confirmPassword")}
          requiredLabel
          error={errors.confirm}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" block loading={loading}>
          {t("auth.reset.submit")}
        </Button>
      </form>
    </AuthLayout>
  );
}
