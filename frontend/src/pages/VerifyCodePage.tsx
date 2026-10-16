import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { ApiError, apiErrorCode, apiPost, exchangeOneTimeToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { CodeInput, ErrorSummary, Field, Button, toast } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";

const CODE_ID = "verify-code";

/** "14:35" in the user's locale from the UTC ISO timestamp `retryAt`; undefined when unusable. */
function formatTime(retryAt: string | undefined, locale: string): string | undefined {
  if (!retryAt) return undefined;
  const date = new Date(retryAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * /verify-email?email=… : confirms a new account with the 6-digit code from the e-mail. The e-mail
 * address travels in the query (survives a reload). A correct code returns a one-time login token that
 * is exchanged for the tokens right away, then the user lands where a normal login ends.
 */
export default function VerifyCodePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const email = params.get("email")?.trim() ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState("");
  const [errorSignal, setErrorSignal] = useState(0);
  const [resendBusy, setResendBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: number; text: string } | null>(null);

  if (!email) return <Navigate to="/login" replace />;

  function focusFirst() {
    document.getElementById(CODE_ID)?.focus();
  }

  async function submit(full: string) {
    if (busy) return;
    setBusy(true);
    setFieldError("");
    setNotice(null);
    try {
      const { loginToken } = await apiPost<{ loginToken: string }>("/api/auth/verify-email", {
        email,
        code: full,
      });
      const data = await exchangeOneTimeToken(loginToken);
      login(data.access_token, data.refresh_token, data.user);
      navigate("/clubs", { replace: true });
    } catch (err: unknown) {
      const errCode = apiErrorCode(err);
      if (errCode === "invalid_verification_code") {
        setFieldError(t("auth.verify.invalidCode"));
        setErrorSignal((n) => n + 1);
        setCode("");
        setBusy(false);
        // the fields are disabled while busy: focus after they are enabled again
        setTimeout(focusFirst, 0);
        return;
      }
      if (errCode === "invalid_grant") {
        toast.error(t("auth.verify.sessionError"));
        navigate("/login", { replace: true });
        return;
      }
      setCode("");
      setNotice({
        key: Date.now(),
        text:
          errCode === "rate_limited"
            ? t("auth.verify.tooManyRequests")
            : t("auth.verify.genericError"),
      });
      setBusy(false);
    }
  }

  async function resend() {
    setResendBusy(true);
    setNotice(null);
    try {
      await apiPost("/api/auth/resend-verification", { email });
      setFieldError("");
      setCode("");
      toast.success(t("auth.verify.resendSent"));
      focusFirst();
    } catch (err: unknown) {
      const errCode = apiErrorCode(err);
      let text: string;
      if (errCode === "verification_resend_too_early") {
        const time = formatTime(
          err instanceof ApiError ? err.retryAt : undefined,
          i18n.resolvedLanguage ?? "en",
        );
        text = time
          ? t("auth.verify.resendTooEarly", { time })
          : t("auth.verify.resendTooEarlyNoTime");
      } else if (errCode === "rate_limited") {
        text = t("auth.verify.tooManyRequests");
      } else {
        text = t("auth.verify.resendFailed");
      }
      setNotice({ key: Date.now(), text });
    } finally {
      setResendBusy(false);
    }
  }

  return (
    <AuthLayout
      wide
      icon="mail"
      title={t("auth.verify.title")}
      intro={
        <Trans i18nKey="auth.verify.intro" values={{ email }} components={{ strong: <strong /> }} />
      }
      footer={
        <Link to="/login" className="ap-link">
          {t("auth.verify.backToLogin")}
        </Link>
      }
    >
      <div className="ap-stack">
        {notice && (
          <FocusBanner key={notice.key} tone="danger" title={t("auth.verify.errorTitle")}>
            {notice.text}
          </FocusBanner>
        )}
        <form
          className="ap-form"
          aria-label={t("auth.verify.title")}
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code)) void submit(code);
          }}
          noValidate
        >
          <ErrorSummary
            title={t("auth.verify.errorTitle")}
            focusSignal={errorSignal}
            errors={fieldError ? [{ fieldId: CODE_ID, message: fieldError }] : []}
          />
          <Field
            group
            id={CODE_ID}
            label={t("auth.verify.codeLabel")}
            error={fieldError}
            hint={t("auth.verify.hint")}
          >
            <CodeInput
              id={CODE_ID}
              label={t("auth.verify.codeLabel")}
              value={code}
              onChange={setCode}
              onComplete={(full) => void submit(full)}
              invalid={!!fieldError}
              describedBy={fieldError ? `${CODE_ID}-error` : `${CODE_ID}-hint`}
              disabled={busy}
            />
          </Field>
          <p className="t-sm t-muted text-center" role="status" aria-live="polite">
            {busy ? t("auth.verify.checking") : ""}
          </p>
        </form>
        <div className="flex justify-center">
          <Button
            variant="ghost"
            onClick={() => void resend()}
            loading={resendBusy}
            disabled={busy}
          >
            {t("auth.verify.resend")}
          </Button>
        </div>
      </div>
    </AuthLayout>
  );
}
