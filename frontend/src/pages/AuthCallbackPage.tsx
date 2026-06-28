import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { storeTokens, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FullPageLoader } from "@/components/ui/shared";
import type { User } from "@/lib/types";

export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refresh_token");
    const error = searchParams.get("error");

    if (error) {
      navigate(`/login?error=${error}`, { replace: true });
      return;
    }
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }
    if (refreshToken) {
      storeTokens(token, refreshToken);
    } else {
      storeTokens(token, "");
    }
    apiGet<User>("/api/auth/me")
      .then((user) => {
        login(token, refreshToken ?? "", user);
        navigate("/clubs", { replace: true });
      })
      .catch(() => navigate("/login?error=oauth_failed", { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <FullPageLoader message={t("auth.completingSignIn")} />;
}
