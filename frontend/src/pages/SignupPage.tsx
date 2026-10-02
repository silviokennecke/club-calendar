import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";
import i18n from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { LangSwitch, Logo } from "@/components/ui/shared";

export default function SignupPage() {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }
    if (password.length < 8) {
      setError(t("auth.passwordTooShort"));
      return;
    }
    setLoading(true);
    try {
      await apiPost("/api/auth/register", {
        name,
        email,
        password,
        language: i18n.resolvedLanguage ?? "en",
      });
      setSubmittedEmail(email);
      setSubmitted(true);
    } catch (e: unknown) {
      setError((e as Error).message ?? t("auth.signingUp"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50">
      <div className="absolute top-4 right-4">
        <LangSwitch />
      </div>
      <Card className="w-full max-w-sm border-slate-200 shadow-md">
        <CardHeader className="pb-2">
          <div className="mb-1">
            <Logo size={28} />
          </div>
          <CardTitle className="text-xl">
            {submitted ? t("auth.checkYourEmail") : t("auth.createAccount")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {submitted ? (
            <p className="text-sm text-slate-600">
              {t("auth.checkYourEmailMessage", { email: submittedEmail })}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="name">{t("auth.fullName")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
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
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.creatingAccount") : t("auth.createAccount")}
              </Button>
            </form>
          )}
        </CardContent>
        {!submitted && (
          <CardFooter className="justify-center pt-0">
            <p className="text-sm text-slate-500">
              {t("auth.alreadyHaveAccount")}{" "}
              <Link to="/login" className="font-medium text-blue-600 hover:underline">
                {t("auth.signIn")}
              </Link>
            </p>
          </CardFooter>
        )}
      </Card>
    </div>
  );
}
