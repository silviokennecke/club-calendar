import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  apiPost,
  isMfaChallenge,
  sessionUser,
  type LoginResult,
  type MfaChallenge,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
import { MfaStep } from "@/components/auth/MfaStep";

const PASSWORD_ID = "login-password";

/** Step 2 for an existing account: password sign-in (address fixed). */
export function LoginStep({ email, onBack }: { email: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<{
    kind: "wrong" | "rate" | "mfaExpired";
    text?: string;
  } | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const form = useFieldTouch<"password">();

  useEffect(() => {
    if (!challenge) document.getElementById(PASSWORD_ID)?.focus();
  }, [challenge]);

  const missing = password ? undefined : t("auth.login.passwordMissing");
  const error = form.shown("password") ? missing : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    form.submit();
    if (missing) return;

    setLoading(true);
    try {
      const data = await apiPost<LoginResult>("/api/auth/login", { email, password });
      if (isMfaChallenge(data)) {
        setChallenge(data);
        return;
      }
      login(data.access_token, data.refresh_token, sessionUser(data));
      // an unconfirmed address is a restricted session: confirm it with the mailed code first
      navigate(data.emailVerificationRequired ? "/verify-email" : "/clubs");
    } catch (err: unknown) {
      setProblem(
        isRateLimited(err) ? { kind: "rate", text: rateLimitText(t, err) } : { kind: "wrong" },
      );
      setProblemKey((k) => k + 1);
    } finally {
      setLoading(false);
    }
  }

  if (challenge) {
    return (
      <MfaStep
        challenge={challenge}
        onBack={() => {
          setChallenge(null);
          setPassword("");
        }}
        onExpired={() => {
          setChallenge(null);
          setPassword("");
          setProblem({ kind: "mfaExpired" });
          setProblemKey((k) => k + 1);
        }}
      />
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
      {problem?.kind === "mfaExpired" && (
        <FocusBanner key={problemKey} tone="warning" title={t("auth.mfa.expiredTitle")}>
          {t("auth.mfa.expiredText")}
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
      <input
        type="email"
        id="username"
        name="username"
        className="sr-only"
        value={email}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="username"
      />
      <Field id="login-email" label={t("auth.email")}>
        <TextInput
          type="email"
          value={email}
          readOnly
          autoComplete="off"
          inputMode="email"
          spellCheck={false}
        />
      </Field>
      <PasswordField
        id={PASSWORD_ID}
        label={t("auth.password")}
        requiredLabel
        hideRequiredMarker
        error={error}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={(e) => form.touch("password", e)}
        name="password"
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
