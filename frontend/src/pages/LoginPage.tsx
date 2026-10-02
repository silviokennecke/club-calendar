import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost, apiFetch, BACKEND_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";
import {
  Button,
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
import { useResendVerification } from "@/components/auth/useResendVerification";

interface SsoProvider {
  id: string;
  name: string;
  icon: string;
}

const PROVIDER_GLYPH: Record<string, Glyph> = { microsoft: "building" };

type LoginProblem = "wrong" | "unverified" | "passkey" | null;

export default function LoginPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<LoginProblem>(null);
  // Bumped on every new problem so the banner remounts and takes focus again.
  const [problemKey, setProblemKey] = useState(0);
  // The OAuth callback redirects here with ?error=... when the provider sign-in failed.
  const [ssoError, setSsoError] = useState(searchParams.has("error"));
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const resend = useResendVerification();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/providers`)
      .then((r) => r.json())
      .then((list) => setProviders(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  function show(next: LoginProblem) {
    setSsoError(false);
    setProblem(next);
    setProblemKey((k) => k + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setSsoError(false);
    resend.reset();
    setLoading(true);
    try {
      const data = await apiPost<{ access_token: string; refresh_token: string; user: User }>(
        "/api/auth/login",
        { email, password },
      );
      login(data.access_token, data.refresh_token, data.user);
      navigate("/clubs");
    } catch (err: unknown) {
      if (err instanceof Error && (err as { status?: number }).status === 403) {
        show("unverified");
      } else {
        show("wrong");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    setProblem(null);
    setSsoError(false);
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
      {problem === "unverified" && !resend.done && (
        <FocusBanner
          key={problemKey}
          tone="warning"
          title={t("auth.login.unverifiedTitle")}
          action={
            <Button
              variant="secondary"
              loading={resend.loading}
              onClick={() => resend.resend(email)}
            >
              {t("auth.login.resend")}
            </Button>
          }
        >
          {t("auth.login.unverifiedText")}
        </FocusBanner>
      )}
      {problem === "unverified" && resend.done && (
        <FocusBanner tone="success" title={t("auth.login.sentTitle")}>
          {t("auth.login.sentText")}
        </FocusBanner>
      )}
      {problem === "passkey" && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.login.passkeyErrorTitle")}>
          {t("auth.login.passkeyErrorText")}
        </FocusBanner>
      )}
      {ssoError && (
        <FocusBanner tone="danger" title={t("auth.login.ssoErrorTitle")}>
          {t("auth.login.ssoErrorText")}
        </FocusBanner>
      )}

      <form className="ap-form" aria-label={t("auth.login.formLabel")} onSubmit={handleSubmit}>
        <Field label={t("auth.email")}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
            inputMode="email"
          />
        </Field>
        <PasswordField
          label={t("auth.password")}
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
