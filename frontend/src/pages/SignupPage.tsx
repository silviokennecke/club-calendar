import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";
import i18n from "@/lib/i18n";
import { Button, Field, LinkButton, PasswordField, TextInput } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";

const MIN_PASSWORD_LENGTH = 8;

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

type Problem = "missing" | "short" | "mismatch" | "exists" | "generic";

export default function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);

  function fail(next: Problem, fieldErrors: FieldErrors = {}) {
    setErrors(fieldErrors);
    setProblem(next);
    setProblemKey((k) => k + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setErrors({});

    const found: FieldErrors = {};
    if (!name.trim()) found.name = t("auth.register.nameMissing");
    if (!email.trim()) found.email = t("auth.register.emailMissing");
    if (!password) found.password = t("auth.register.passwordMissing");
    else if (password.length < MIN_PASSWORD_LENGTH)
      found.password = t("auth.register.passwordShortField");
    if (password && confirm !== password) found.confirm = t("auth.register.confirmMismatchField");

    if (Object.keys(found).length > 0) {
      const empty = !name.trim() || !email.trim() || !password;
      fail(empty ? "missing" : password.length < MIN_PASSWORD_LENGTH ? "short" : "mismatch", found);
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
      navigate(`/auth/verify-email?email=${encodeURIComponent(email)}`);
    } catch (err: unknown) {
      // Stable error code of the API (RFC 7807 body), never the English `detail` text
      if ((err as { code?: string }).code === "email_taken") {
        fail("exists", { email: t("auth.register.emailExistsField") });
      } else {
        fail("generic");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.createAccount")}
      footer={
        <>
          {t("auth.register.haveAccount")}{" "}
          <Link to="/login" className="ap-link">
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      {problem && (
        <FocusBanner
          key={problemKey}
          tone="danger"
          title={t("auth.register.errorTitle")}
          action={
            problem === "exists" ? (
              <LinkButton to="/login" variant="secondary">
                {t("auth.register.toLogin")}
              </LinkButton>
            ) : undefined
          }
        >
          {t(`auth.register.problem.${problem}`)}
        </FocusBanner>
      )}
      <form
        className="ap-form"
        aria-label={t("auth.createAccount")}
        onSubmit={handleSubmit}
        noValidate
      >
        <Field label={t("auth.register.name")} required error={errors.name}>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label={t("auth.email")} required error={errors.email}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </Field>
        <PasswordField
          label={t("auth.password")}
          requiredLabel
          hint={t("auth.register.passwordHint")}
          error={errors.password}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordField
          label={t("auth.register.confirmPassword")}
          requiredLabel
          error={errors.confirm}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        <Button type="submit" block loading={loading} loadingLabel={t("auth.creatingAccount")}>
          {t("auth.createAccount")}
        </Button>
      </form>
    </AuthLayout>
  );
}
