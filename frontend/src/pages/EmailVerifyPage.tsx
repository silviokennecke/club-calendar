import { useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EmailVerifyPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const status = params.get("status");
  const reason = params.get("reason");

  const isSuccess = status === "success";

  function getMessage() {
    if (isSuccess) return t("auth.emailVerified");
    if (reason === "expired") return t("auth.verificationLinkExpired");
    if (reason === "already_used") return t("auth.verificationLinkAlreadyUsed");
    return t("auth.verificationLinkInvalid");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Card className="w-full max-w-sm border-slate-200 shadow-md">
        <CardHeader className="pb-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xl">📅</span>
            <span className="text-sm text-slate-500">Club Calendar</span>
          </div>
          <CardTitle className="text-xl">
            {isSuccess ? t("auth.emailVerified") : t("auth.verificationLinkInvalid")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">{getMessage()}</p>
          {isSuccess && (
            <p className="text-sm text-slate-500">{t("auth.emailVerifiedLoginPrompt")}</p>
          )}
          <Link to="/login" className="block text-sm font-medium text-blue-600 hover:underline">
            {isSuccess ? t("auth.backToLogin") : t("auth.requestNewLink")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
