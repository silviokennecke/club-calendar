import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  apiPost,
  sessionUser,
  type MfaChallenge,
  type MfaTokenResponse,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { announceBackupCodeUsed } from "@/lib/backupCodeNotice";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";
import { Button, Field, TextInput } from "@/components/ui/shared";
import { FocusBanner } from "@/components/auth/FocusBanner";

type Method = "totp" | "backup_code";
type Problem = { kind: "passkey" | "rate"; text?: string } | null;

const CODE_ID = "mfa-code";

/** Step 3 of a sign-in with MFA: authenticator code, backup code or passkey. */
export function MfaStep({
  challenge,
  onBack,
  onExpired,
}: {
  challenge: MfaChallenge;
  onBack: () => void;
  onExpired: () => void;
}) {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const hasTotp = challenge.methods.includes("totp");
  const hasPasskey = challenge.methods.includes("passkey");
  const [method, setMethod] = useState<Method>(hasTotp ? "totp" : "backup_code");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  useEffect(() => {
    document.getElementById(CODE_ID)?.focus();
  }, [method]);

  function finish(data: MfaTokenResponse) {
    login(data.access_token, data.refresh_token, sessionUser(data));
    if (data.backupCodeUsed) announceBackupCodeUsed(data.backupCodesRemaining ?? 0);
    navigate(data.emailVerificationRequired ? "/verify-email" : "/clubs");
  }

  function fail(err: unknown, kind: "passkey" | "code") {
    if (err instanceof ApiError && err.code === "invalid_mfa_token") {
      onExpired();
      return;
    }
    if (isRateLimited(err)) {
      setProblem({ kind: "rate", text: rateLimitText(t, err) });
    } else if (kind === "code") {
      setCodeError(t("auth.mfa.codeWrong"));
    } else {
      setProblem({ kind: "passkey" });
    }
    setProblemKey((k) => k + 1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setCodeError(undefined);
    const value = code.trim();
    if (!value) {
      setCodeError(t("auth.mfa.codeMissing"));
      return;
    }
    setLoading(true);
    try {
      const data = await apiPost<MfaTokenResponse>("/api/auth/mfa/verify", {
        mfaToken: challenge.mfaToken,
        method,
        code: value,
      });
      finish(data);
    } catch (err: unknown) {
      fail(err, "code");
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    setProblem(null);
    setPasskeyLoading(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const { options, challengeToken } = await apiPost<{
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeToken: string;
      }>("/api/auth/mfa/passkey/options", { mfaToken: challenge.mfaToken });
      const response = await startAuthentication({ optionsJSON: options });
      const data = await apiPost<MfaTokenResponse>("/api/auth/mfa/passkey/verify", {
        mfaToken: challenge.mfaToken,
        challengeToken,
        response,
      });
      finish(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (err instanceof ApiError || !(msg.includes("cancel") || msg.includes("abort"))) {
        fail(err, "passkey");
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  function switchTo(next: Method) {
    setMethod(next);
    setCode("");
    setCodeError(undefined);
    setProblem(null);
  }

  const isTotp = method === "totp";

  return (
    <form
      className="ap-form"
      aria-label={t("auth.mfa.formLabel")}
      onSubmit={handleSubmit}
      noValidate
    >
      {problem?.kind === "rate" && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.rateLimitedTitle")}>
          {problem.text}
        </FocusBanner>
      )}
      {problem?.kind === "passkey" && (
        <FocusBanner key={problemKey} tone="danger" title={t("auth.mfa.passkeyErrorTitle")}>
          {t("auth.mfa.passkeyErrorText")}
        </FocusBanner>
      )}
      <p className="t-sm t-muted">{t(isTotp ? "auth.mfa.totpIntro" : "auth.mfa.backupIntro")}</p>
      <Field
        id={CODE_ID}
        label={t(isTotp ? "auth.mfa.totpLabel" : "auth.mfa.backupLabel")}
        error={codeError}
      >
        <TextInput
          key={method}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete={isTotp ? "one-time-code" : "off"}
          inputMode={isTotp ? "numeric" : "text"}
          maxLength={isTotp ? 8 : 32}
          spellCheck={false}
          autoCapitalize="none"
        />
      </Field>
      <Button type="submit" block loading={loading} loadingLabel={t("auth.mfa.verifying")}>
        {t("auth.mfa.verify")}
      </Button>
      {isTotp ? (
        <Button variant="ghost" block onClick={() => switchTo("backup_code")}>
          {t("auth.mfa.useBackup")}
        </Button>
      ) : (
        hasTotp && (
          <Button variant="ghost" block onClick={() => switchTo("totp")}>
            {t("auth.mfa.useTotp")}
          </Button>
        )
      )}
      {hasPasskey && (
        <Button
          variant="secondary"
          block
          loading={passkeyLoading}
          loadingLabel={t("auth.passkeyWaiting")}
          onClick={handlePasskey}
        >
          {t("auth.mfa.usePasskey")}
        </Button>
      )}
      <Button variant="ghost" block icon="arrow-left" onClick={onBack}>
        {t("auth.mfa.back")}
      </Button>
    </form>
  );
}
