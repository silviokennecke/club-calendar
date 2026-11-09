import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost, sessionUser, type TokenResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  loginProtocol,
  opaqueFailureKind,
  opaqueLogin,
  prefetchOpaque,
  startOpaqueUpgrade,
  type IdentifyAuth,
} from "@/lib/opaque";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";
import { useFieldTouch } from "@/lib/useFieldTouch";
import {
  Button,
  ErrorSummary,
  Field,
  LinkButton,
  PasswordField,
  TextInput,
} from "@/components/ui/shared";
import { FocusBanner } from "@/components/auth/FocusBanner";

const PASSWORD_ID = "login-password";

interface LoginStepProps {
  email: string;
  /** `auth` hint of identify: picks OPAQUE or the legacy login; `reset_required` has no password step. */
  auth?: IdentifyAuth;
  onBack: () => void;
}

type Problem = { kind: "wrong" | "rate" | "unsupported" | "unavailable"; text?: string };

/** Step 2 for an existing account: password sign-in (address fixed). */
export function LoginStep({ email, auth, onBack }: LoginStepProps) {
  const protocol = loginProtocol(auth);
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const form = useFieldTouch<"password">();

  useEffect(() => {
    document.getElementById(PASSWORD_ID)?.focus();
  }, [protocol]);

  const missing = password ? undefined : t("auth.login.passwordMissing");
  const error = form.shown("password") ? missing : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    form.submit();
    if (missing) return;

    setLoading(true);
    try {
      const data =
        protocol === "opaque"
          ? await opaqueLogin(email, password)
          : await apiPost<TokenResponse>("/api/auth/login", { email, password });
      login(data.access_token, data.refresh_token, sessionUser(data));
      // an unconfirmed address is a restricted session: confirm it with the mailed code first
      navigate(data.emailVerificationRequired ? "/verify-email" : "/clubs");
      if (protocol !== "opaque") startOpaqueUpgrade(data.opaqueUpgrade, password);
      setPassword("");
    } catch (err: unknown) {
      const failure = opaqueFailureKind(err);
      setProblem(
        isRateLimited(err)
          ? { kind: "rate", text: rateLimitText(t, err) }
          : failure
            ? { kind: failure }
            : { kind: "wrong" },
      );
      setProblemKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  }

  if (protocol === "reset") {
    return (
      <div className="ap-stack">
        <FocusBanner
          tone="warning"
          title={t("auth.login.resetRequiredTitle")}
          action={
            <LinkButton to="/forgot-password" variant="secondary">
              {t("auth.login.resetPassword")}
            </LinkButton>
          }
        >
          {t("auth.login.resetRequiredText")}
        </FocusBanner>
        <Button variant="ghost" block icon="arrow-left" onClick={onBack}>
          {t("auth.entry.back")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="ap-form"
      aria-label={t("auth.login.formLabel")}
      onSubmit={handleSubmit}
      noValidate
    >
      {problem?.kind === "wrong" && (
        <FocusBanner
          key={problemKey}
          tone="danger"
          title={t("auth.login.wrongTitle")}
          action={
            <LinkButton to="/forgot-password" variant="secondary">
              {t("auth.login.resetPassword")}
            </LinkButton>
          }
        >
          {t("auth.login.wrongText")}
        </FocusBanner>
      )}
      {(problem?.kind === "unsupported" || problem?.kind === "unavailable") && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.login.wrongTitle")}>
          {t(problem.kind === "unsupported" ? "auth.opaqueUnsupported" : "auth.opaqueUnavailable")}
        </FocusBanner>
      )}
      {problem?.kind === "rate" && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.rateLimitedTitle")}>
          {problem.text}
        </FocusBanner>
      )}
      <ErrorSummary
        title={t("auth.login.errorTitle")}
        focusSignal={form.submits}
        errors={error ? [{ fieldId: PASSWORD_ID, message: error }] : []}
      />
      <Field id="login-email" label={t("auth.email")}>
        <TextInput
          type="email"
          value={email}
          readOnly
          autoComplete="username"
          inputMode="email"
          spellCheck={false}
        />
      </Field>
      <PasswordField
        id={PASSWORD_ID}
        label={t("auth.password")}
        requiredLabel
        error={error}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={(e) => form.touch("password", e)}
        onFocus={protocol === "opaque" ? prefetchOpaque : undefined}
        autoComplete="current-password"
      />
      <Link
        to="/forgot-password"
        className="ap-link t-sm min-h-tap inline-flex items-center self-start"
      >
        {t("auth.login.forgot")}
      </Link>
      <Button type="submit" block loading={loading} loadingLabel={t("auth.signingIn")}>
        {t("auth.signIn")}
      </Button>
      <p className="t-sm t-muted">{t("auth.entry.otherMethodHint")}</p>
      <Button variant="ghost" block icon="arrow-left" onClick={onBack}>
        {t("auth.entry.back")}
      </Button>
    </form>
  );
}
