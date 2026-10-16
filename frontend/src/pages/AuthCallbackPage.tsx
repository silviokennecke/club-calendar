import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { storeTokens, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import type { User } from "@/lib/types";

/**
 * SSO return point: stores the tokens, loads the user and continues to /clubs.
 * Any failure goes back to /login?error=..., where the login page explains it.
 */
export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refresh_token");
    const error = searchParams.get("error");

    if (error === "email_verification_required" && searchParams.get("email")) {
      // untrusted provider: no tokens, the address is confirmed with a code first
      navigate(`/verify-email?email=${encodeURIComponent(searchParams.get("email") ?? "")}`, {
        replace: true,
      });
      return;
    }
    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!token) {
      navigate("/login?error=oauth_failed", { replace: true });
      return;
    }
    storeTokens(token, refreshToken ?? "");
    apiGet<User>("/api/auth/me")
      .then((user) => {
        login(token, refreshToken ?? "", user);
        navigate("/clubs", { replace: true });
      })
      .catch(() => navigate("/login?error=oauth_failed", { replace: true }));
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
