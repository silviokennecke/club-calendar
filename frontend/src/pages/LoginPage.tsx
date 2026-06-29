import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost, apiFetch, BACKEND_URL } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SsoProviderIcon } from "@/components/SsoProviderIcon";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { Alert } from "@/components/ui/shared";

interface SsoProvider {
  id: string;
  name: string;
  icon: string;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendLoading, setResendLoading] = useState(false);
  const [resendDone, setResendDone] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/providers`)
      .then((r) => r.json())
      .then(setProviders)
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setEmailNotVerified(false);
    setResendDone(false);
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
        setEmailNotVerified(true);
        setResendEmail(email);
      } else {
        setError(t("auth.invalidEmailOrPassword"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResendLoading(true);
    try {
      const res = await apiFetch("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email: resendEmail }),
      });
      if (!res.ok) {
        throw new Error("Request failed");
      }
      // Server returns 204 No Content — no body to parse
    } catch {
      // silently ignore
    } finally {
      setResendLoading(false);
      setResendDone(true);
    }
  }

  async function handlePasskey() {
    setError("");
    setPasskeyLoading(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const optRes = await apiFetch("/api/auth/webauthn/authenticate/options");

      const { options, challengeToken } = (await optRes.json()) as {
        options: any;
        challengeToken: string;
      };
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await apiFetch("/api/auth/webauthn/authenticate/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, response }),
      });
      if (!verifyRes.ok) {
        setError(t("auth.passkeyFailed"));
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
      if (!msg.includes("cancel") && !msg.includes("abort")) setError(t("auth.passkeyFailed"));
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm border-slate-200 shadow-md">
        <CardHeader className="pb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xl">📅</span>
            <span className="text-sm text-slate-500">Club Calendar</span>
          </div>
          <CardTitle className="text-xl">{t("auth.signIn")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {emailNotVerified && (
              <Alert
                variant="warning"
                message={resendDone ? t("auth.verificationEmailSent") : t("auth.emailNotVerified")}
                actions={
                  !resendDone ? (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resendLoading}
                      className="text-sm font-medium underline hover:no-underline"
                    >
                      {t("auth.resendVerificationEmail")}
                    </button>
                  ) : undefined
                }
              />
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>

          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={passkeyLoading}
            onClick={handlePasskey}
          >
            🔑 {passkeyLoading ? t("auth.passkeyWaiting") : t("auth.passkey")}
          </Button>

          {providers.length > 0 && (
            <>
              <div className="relative">
                <Separator />
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-2 text-xs text-slate-400">
                  {t("auth.orContinueWith")}
                </span>
              </div>
              <div className="space-y-2">
                {providers.map((provider) => (
                  <a
                    key={provider.id}
                    href={`${BACKEND_URL}/api/auth/oauth/${provider.id}`}
                    className="block"
                  >
                    <Button variant="outline" className="w-full justify-center gap-2">
                      <SsoProviderIcon icon={provider.icon} />
                      {provider.name}
                    </Button>
                  </a>
                ))}
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="justify-center pt-0">
          <p className="text-sm text-slate-500">
            {t("auth.noAccount")}{" "}
            <Link to="/signup" className="font-medium text-blue-600 hover:underline">
              {t("auth.signUp")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
