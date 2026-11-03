import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { storeTokens, apiGet, exchangeOneTimeToken, ApiError } from "@/lib/api";
import { takeSsoVerifier } from "@/lib/ssoBinding";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import type { User } from "@/lib/types";

/**
 * SSO return point: the redirect carries a single-use one-time code (never the tokens). The code leaves the
 * address bar first, is then exchanged for the token pair (`POST /api/auth/token`), the user is loaded and
 * the app continues at /clubs (or at /verify-email for a restricted session). The code is bound to this tab by a PKCE verifier (`lib/ssoBinding`). Any failure goes back to /login?error=..., where the login page explains it.
 */
export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  // The code works once: a second effect run (StrictMode) must not redeem it again.
  const started = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!code) {
      navigate("/login?error=oauth_failed", { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;
    // Out of the address bar and the history before anything else happens.
    window.history.replaceState(window.history.state, "", window.location.pathname);
    // Only the tab that started the flow has the verifier (login CSRF / another tab or browser: none).
    const verifier = takeSsoVerifier();
    if (!verifier) {
      navigate("/login?error=invalid_code_verifier", { replace: true });
      return;
    }

    void (async () => {
      try {
        const tokens = await exchangeOneTimeToken(code, verifier);
        storeTokens(tokens.access_token, tokens.refresh_token);
        const user = await apiGet<User>("/api/auth/me");
        login(tokens.access_token, tokens.refresh_token, user);
        // a provider that does not prove the address (Microsoft) gives a restricted session
        navigate(user.emailVerificationRequired ? "/verify-email" : "/clubs", { replace: true });
      } catch (e) {
        const code =
          e instanceof ApiError && e.code === "invalid_grant"
            ? "invalid_login_code"
            : e instanceof ApiError && e.code === "invalid_code_verifier"
              ? "invalid_code_verifier"
              : "oauth_failed";
        navigate(`/login?error=${code}`, { replace: true });
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AuthLayout title={t("auth.callback.title")}>
      <p className="t-body t-muted flex items-center gap-2" role="status" aria-busy="true">
        <Icon glyph="loader" size={20} className="animate-spin motion-reduce:animate-none" />
        {t("auth.completingSignIn")}
      </p>
    </AuthLayout>
  );
}
