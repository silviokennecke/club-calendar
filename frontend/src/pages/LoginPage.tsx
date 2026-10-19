import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ApiError, apiPost, apiFetch, BACKEND_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { ssoErrorKey } from "@/lib/ssoError";
import type { User } from "@/lib/types";
import {
  Button,
  ErrorSummary,
  Field,
  Icon,
  LinkButton,
  PasswordField,
  TextInput,
  buttonClass,
  type Glyph,
} from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";

interface SsoProvider {
  id: string;
  name: string;
  icon: string;
}

const PROVIDER_GLYPH: Record<string, Glyph> = { microsoft: "building" };

type LoginProblem = "wrong" | "passkey" | null;

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_ID = "login-email";
const PASSWORD_ID = "login-password";
/** Loose check (something@something.tld); the backend decides whether the account exists. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<LoginProblem>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Bumped on every new problem so the banner remounts and takes focus again.
  const [problemKey, setProblemKey] = useState(0);
  // The OAuth callback redirects here with ?error=... when the provider sign-in failed.
  const [ssoError, setSsoError] = useState<string | null>(searchParams.get("error"));
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/providers`)
      .then((r) => r.json())
      .then((list) => setProviders(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  function show(next: LoginProblem) {
    setSsoError(null);
    setProblem(next);
    setProblemKey((k) => k + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setSsoError(null);

    // The browser's own "Please fill out this field" bubble is not translated and cannot be styled,
    // so the form has noValidate and checks the fields itself (focus goes to the first invalid one).
    const found: FieldErrors = {};
    if (!email.trim()) found.email = t("auth.login.emailMissing");
    else if (!EMAIL_SHAPE.test(email.trim())) found.email = t("auth.login.emailInvalid");
    if (!password) found.password = t("auth.login.passwordMissing");
    setErrors(found);
    const firstInvalid = found.email ? EMAIL_ID : found.password ? PASSWORD_ID : null;
    if (firstInvalid) {
      document.getElementById(firstInvalid)?.focus();
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost<{ access_token: string; refresh_token: string; user: User }>(
        "/api/auth/login",
        { email, password },
      );
      login(data.access_token, data.refresh_token, data.user);
      navigate("/clubs");
    } catch (err: unknown) {
      // 403 `code: email_not_verified` (RFC 7807 problem like every API error)
      if (err instanceof ApiError && err.code === "email_not_verified") {
        // the backend has sent a fresh code if needed: confirm the address with it
        navigate(`/verify-email?email=${encodeURIComponent(err.email ?? email.trim())}`);
      } else {
        show("wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    setProblem(null);
    setSsoError(null);
    setPasskeyLoading(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const optRes = await apiFetch("/api/auth/webauthn/authenticate/options");

      const { options, challengeToken } = (await optRes.json()) as {
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeToken: string;
      };
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await apiFetch("/api/auth/webauthn/authenticate/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, response }),
      });
      if (!verifyRes.ok) {
        show("passkey");
        return;
      }
      const data = (await verifyRes.json()) as {
        access_token: string;
        refresh_token: string;
        user: User;
      };
      login(data.access_token, data.refresh_token, data.user);
      navigate("/clubs");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("cancel") && !msg.includes("abort")) show("passkey");
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.signIn")}
      footer={
        <>
          {t("auth.noAccount")}{" "}
          <Link to="/signup" className="ap-link">
            {t("auth.createAccount")}
          </Link>
        </>
      }
    >
      {problem === "wrong" && (
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
      {problem === "passkey" && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.login.passkeyErrorTitle")}>
          {t("auth.login.passkeyErrorText")}
        </FocusBanner>
      )}
      {ssoError !== null && (
        <FocusBanner tone="danger" title={t("auth.login.ssoErrorTitle")}>
          {t(ssoErrorKey(ssoError))}
        </FocusBanner>
      )}

      <form
        className="ap-form"
        aria-label={t("auth.login.formLabel")}
        onSubmit={handleSubmit}
        noValidate
      >
        <ErrorSummary
          title={t("auth.login.errorTitle")}
          errors={[
            ...(errors.email ? [{ fieldId: EMAIL_ID, message: errors.email }] : []),
            ...(errors.password ? [{ fieldId: PASSWORD_ID, message: errors.password }] : []),
          ]}
        />
        <Field id={EMAIL_ID} label={t("auth.email")} error={errors.email}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            inputMode="email"
            spellCheck={false}
          />
        </Field>
        <PasswordField
          id={PASSWORD_ID}
          label={t("auth.password")}
          error={errors.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
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
      </form>

      <div className="ap-divider-text">
        <span>{t("auth.or")}</span>
      </div>
      <div className="ap-stack ap-stack--sm">
        <Button
          variant="sso"
          icon="key"
          loading={passkeyLoading}
          loadingLabel={t("auth.passkeyWaiting")}
          onClick={handlePasskey}
        >
          {t("auth.passkey")}
        </Button>
        {providers.map((provider) => (
          <a
            key={provider.id}
            href={`${BACKEND_URL}/api/auth/oauth/${provider.id}`}
            className={buttonClass("sso")}
          >
            <Icon glyph={PROVIDER_GLYPH[provider.id] ?? "globe"} size={20} />
            {t("auth.login.signInWith", { provider: provider.name })}
          </a>
        ))}
      </div>
    </AuthLayout>
  );
}
