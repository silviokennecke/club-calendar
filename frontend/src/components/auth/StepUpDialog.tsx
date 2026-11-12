import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  Chip,
  CodeInput,
  Field,
  FormDialog,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { ReauthFields } from "@/components/profile/ReauthFields";
import {
  emptyReauth,
  reauthBody,
  reauthFieldError,
  reauthMissing,
} from "@/components/profile/reauth";
import type { ProfileData } from "@/components/profile/profileTypes";
import { apiErrorCode, apiGet, apiPost } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";
import { cancelStepUp, completeStepUp, useStepUpPrompt } from "@/lib/stepUp";

type Method = "totp" | "backup_code" | "passkey";

interface StepUpResponse {
  stepUpToken: string;
  expiresIn: number;
  backupCodeUsed?: boolean;
  backupCodesRemaining?: number;
}

interface Info {
  hasPassword: boolean;
  email: string;
  enforced: boolean;
  methods: Method[];
}

function passkeysSupported() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

function infoFrom(me: ProfileData): Info {
  const methods: Method[] = [];
  if (me.mfa?.totp) methods.push("totp");
  if (me.passkeys?.length > 0 && passkeysSupported()) methods.push("passkey");
  methods.push("backup_code");
  return {
    hasPassword: me.hasPassword,
    email: me.email,
    enforced: !!me.mfa?.enforced,
    methods,
  };
}

/** Mounted once in the app: confirms the account holder for sensitive actions (valid 10 minutes). */
export function StepUpDialog() {
  const open = useStepUpPrompt();
  return open ? <StepUpForm /> : null;
}

function StepUpForm() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [proof, setProof] = useState(emptyReauth);
  const [method, setMethod] = useState<Method>("totp");
  const [factorCode, setFactorCode] = useState("");
  const [proofError, setProofError] = useState<string>();
  const [factorError, setFactorError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => focusFirstInvalid(bodyRef.current), [proofError, factorError]);

  useEffect(() => {
    let live = true;
    apiGet<ProfileData>("/api/auth/me")
      .then((me) => {
        if (!live) return;
        const next = infoFrom(me);
        setInfo(next);
        setMethod(next.methods[0]);
      })
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, []);

  function switchMethod(next: Method) {
    setMethod(next);
    setFactorCode("");
    setFactorError(undefined);
    setFailure(undefined);
  }

  async function passkeyFactor() {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    const { options, challengeToken } = await apiPost<{
      options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      challengeToken: string;
    }>("/api/auth/step-up/passkey/options", undefined);
    const response = await startAuthentication({ optionsJSON: options });
    return { method: "passkey" as const, challengeToken, response };
  }

  async function submit() {
    if (busy || !info) return;
    setProofError(undefined);
    setFactorError(undefined);
    setFailure(undefined);
    const missing = reauthMissing(proof, info.hasPassword, "step_up", t);
    if (missing) {
      setProofError(missing);
      return;
    }
    if (info.enforced && method !== "passkey" && !factorCode.trim()) {
      setFactorError(t("stepUp.factor.codeMissing"));
      return;
    }
    setBusy(true);
    try {
      let factor: unknown;
      if (info.enforced) {
        if (method === "passkey") {
          try {
            factor = await passkeyFactor();
          } catch (error) {
            if (apiErrorCode(error) || isRateLimited(error)) throw error;
            setFailure(t("stepUp.factor.passkeyCancelled"));
            return;
          }
        } else {
          factor = { method, code: factorCode.trim() };
        }
      }
      const res = await apiPost<StepUpResponse>("/api/auth/step-up", {
        ...reauthBody(proof, info.hasPassword),
        ...(factor ? { factor } : {}),
      });
      if (res.backupCodeUsed) {
        toast.success(t("stepUp.backupUsed", { count: res.backupCodesRemaining ?? 0 }));
      }
      completeStepUp(res.stepUpToken, res.expiresIn);
    } catch (error) {
      const code = apiErrorCode(error);
      const wrong = reauthFieldError(error, "step_up", t);
      if (wrong) setProofError(wrong);
      else if (code === "invalid_mfa_code") setFactorError(t("stepUp.factor.codeWrong"));
      else if (code === "invalid_passkey") setFailure(t("stepUp.factor.passkeyFailed"));
      else if (code === "mfa_factor_required") setFailure(t("stepUp.factor.required"));
      else if (isRateLimited(error)) setFailure(rateLimitText(t, error));
      else setFailure(t("stepUp.failed"));
    } finally {
      setBusy(false);
    }
  }

  const methodLabel: Record<Method, string> = {
    totp: t("stepUp.factor.totp"),
    backup_code: t("stepUp.factor.backup"),
    passkey: t("stepUp.factor.passkey"),
  };

  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && cancelStepUp()}
      title={t("stepUp.title")}
      description={t("stepUp.text")}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button variant="secondary" onClick={() => cancelStepUp()} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={busy} disabled={!info}>
            {t("stepUp.confirm")}
          </Button>
        </>
      }
    >
      <div ref={bodyRef} className="ap-stack">
        <p>{t("stepUp.text")}</p>
        {loadFailed && <Banner tone="danger">{t("stepUp.failed")}</Banner>}
        {failure && <Banner tone="danger">{failure}</Banner>}
        {info && (
          <>
            <ReauthFields
              hasPassword={info.hasPassword}
              email={info.email}
              value={proof}
              onChange={setProof}
              error={proofError}
              busy={busy}
              idPrefix="su"
            />
            {info.enforced && (
              <>
                {info.methods.length > 1 && (
                  <div className="ap-chips" role="group" aria-label={t("stepUp.factor.choose")}>
                    {info.methods.map((m) => (
                      <Chip key={m} pressed={method === m} onClick={() => switchMethod(m)}>
                        {methodLabel[m]}
                      </Chip>
                    ))}
                  </div>
                )}
                {method === "totp" && (
                  <Field
                    group
                    id="su-factor"
                    label={t("stepUp.factor.totpLabel")}
                    error={factorError}
                  >
                    <CodeInput
                      id="su-factor"
                      label={t("stepUp.factor.totpLabel")}
                      value={factorCode}
                      onChange={setFactorCode}
                      invalid={!!factorError}
                      describedBy={factorError ? "su-factor-error" : undefined}
                      disabled={busy}
                    />
                  </Field>
                )}
                {method === "backup_code" && (
                  <Field id="su-factor" label={t("stepUp.factor.backupLabel")} error={factorError}>
                    <TextInput
                      value={factorCode}
                      onChange={(e) => setFactorCode(e.target.value)}
                      autoComplete="off"
                      maxLength={32}
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  </Field>
                )}
                {method === "passkey" && <p className="t-sm">{t("stepUp.factor.passkeyText")}</p>}
              </>
            )}
          </>
        )}
      </div>
    </FormDialog>
  );
}
