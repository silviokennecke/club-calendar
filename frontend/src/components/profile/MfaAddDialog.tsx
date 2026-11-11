import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  CodeInput,
  CopyField,
  Field,
  FormDialog,
  Icon,
  QrCode,
  Stepper,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { apiErrorCode, apiGet, apiPatch, apiPost } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";
import { ReauthFields } from "./ReauthFields";
import { emptyReauth, reauthBody, reauthFieldError, reauthMissing } from "./reauth";

interface MfaAddDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called after the profile data changed (refetch it). */
  onChanged: () => void;
  hasPassword: boolean | undefined;
  email: string;
  /** An authenticator app is already set up. */
  totpSet: boolean;
  /** Second factor is enforced (the server then returns no new backup codes). */
  enforced: boolean;
  passkeyCount: number;
}

type Step = "choose" | "pkProof" | "pkName" | "totpScan" | "totpCodes" | "totpProof" | "done";

interface TotpSetup {
  setupToken: string;
  backupCodes: string[] | null;
  secret?: string;
  otpauthUri?: string;
}

interface PasskeyStart {
  options: unknown;
  challengeToken: string;
}

/** Suggested device name such as "Chrome on macOS" from the browser, empty when unknown. */
function suggestDeviceName(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & {
    userAgentData?: { brands?: { brand: string }[]; platform?: string };
  };
  const ua = navigator.userAgent;
  const brands = nav.userAgentData?.brands?.map((b) => b.brand) ?? [];
  let browser = brands.find(
    (b) => /chrome|edge|opera|brave|firefox|safari/i.test(b) && !/chromium/i.test(b),
  );
  if (!browser || /^chromium$/i.test(browser)) {
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\//.test(ua)) browser = "Opera";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
  }
  let os = nav.userAgentData?.platform;
  if (!os) {
    if (/iPhone|iPad/.test(ua)) os = "iOS";
    else if (/Android/.test(ua)) os = "Android";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Linux|X11/.test(ua)) os = "Linux";
  }
  if (browser && os) return `${browser} · ${os}`;
  return browser ?? os ?? "";
}

function passkeysSupported() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

function downloadCodes(codes: string[]) {
  const blob = new Blob([codes.join("\n") + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "backup-codes.txt";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Adds a second-factor method: an authenticator app (setup, code, backup codes, one confirming
 * request) or a passkey (proof, ceremony, then naming the new key). Errors are matched by code.
 */
export function MfaAddDialog({
  open,
  onClose,
  onChanged,
  hasPassword,
  email,
  totpSet,
  enforced: _enforced,
  passkeyCount,
}: MfaAddDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("choose");
  const [proof, setProof] = useState(emptyReauth);
  const [fieldsKey, setFieldsKey] = useState(0);
  const [proofError, setProofError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState<string>();
  const [passkeyId, setPasskeyId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [doneKind, setDoneKind] = useState<"totp" | "passkey">("totp");
  const bodyRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const supported = passkeysSupported();

  useEffect(() => focusFirstInvalid(bodyRef.current), [proofError, codeError, ackError]);
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [step, open]);

  function reset() {
    setStep("choose");
    setProof(emptyReauth);
    setFieldsKey((k) => k + 1);
    setProofError(undefined);
    setFailure(undefined);
    setBusy(false);
    setSetup(null);
    setCode("");
    setCodeError(undefined);
    setAcknowledged(false);
    setAckError(undefined);
    setPasskeyId(null);
    setDeviceName("");
  }

  function close(next = false) {
    if (next) return;
    reset();
    onClose();
  }

  function go(next: Step) {
    setFailure(undefined);
    setProofError(undefined);
    setStep(next);
  }

  function handleProofError(error: unknown) {
    const wrong = reauthFieldError(error, step === "pkProof" ? "passkey" : "mfa", t);
    if (wrong) setProofError(wrong);
    else if (apiErrorCode(error) === "rate_limited") setFailure(t("profile.mfa.add.rateLimited"));
    else return false;
    return true;
  }

  async function startTotp() {
    if (busy) return;
    setBusy(true);
    setFailure(undefined);
    try {
      const res = await apiPost<TotpSetup>("/api/auth/mfa/setup", { method: "totp" });
      setSetup(res);
      setAcknowledged(false);
      go("totpScan");
    } catch (error) {
      const c = apiErrorCode(error);
      if (c === "totp_already_set") setFailure(t("profile.mfa.add.errors.totpAlreadySet"));
      else if (c === "rate_limited") setFailure(t("profile.mfa.add.rateLimited"));
      else setFailure(t("profile.mfa.add.errors.setupFailed"));
    } finally {
      setBusy(false);
    }
  }

  function afterScan() {
    if (!/^\d{6}$/.test(code)) {
      setCodeError(t("profile.mfa.add.totp.codeInvalid"));
      return;
    }
    setCodeError(undefined);
    go(setup?.backupCodes ? "totpCodes" : "totpProof");
  }

  function afterCodes() {
    if (!acknowledged) {
      setAckError(t("profile.mfa.add.codes.ackMissing"));
      return;
    }
    setAckError(undefined);
    go("totpProof");
  }

  async function enableTotp() {
    if (busy || hasPassword === undefined || !setup) return;
    setProofError(undefined);
    setFailure(undefined);
    const missing = reauthMissing(proof, hasPassword, "mfa", t);
    if (missing) {
      setProofError(missing);
      return;
    }
    setBusy(true);
    try {
      await apiPost("/api/auth/mfa/enable", {
        setupToken: setup.setupToken,
        method: "totp",
        secret: setup.secret,
        code,
        ...(setup.backupCodes ? { backupCodes: setup.backupCodes } : {}),
        backupCodesAcknowledged: true,
        ...reauthBody(proof, hasPassword),
      });
      setDoneKind("totp");
      onChanged();
      go("done");
    } catch (error) {
      if (handleProofError(error)) return;
      const c = apiErrorCode(error);
      if (c === "invalid_totp_code") {
        setCodeError(t("profile.mfa.add.totp.codeWrong"));
        go("totpScan");
      } else if (c === "backup_codes_not_acknowledged") {
        setAckError(t("profile.mfa.add.codes.ackMissing"));
        go("totpCodes");
      } else if (c === "invalid_mfa_setup") {
        setFailure(t("profile.mfa.add.errors.setupExpired"));
        setSetup(null);
        setCode("");
        setStep("choose");
      } else if (c === "mfa_already_enabled") {
        setFailure(t("profile.mfa.add.errors.alreadyEnabled"));
      } else setFailure(t("profile.mfa.add.errors.enableFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function addPasskey() {
    if (busy || hasPassword === undefined) return;
    setProofError(undefined);
    setFailure(undefined);
    const missing = reauthMissing(proof, hasPassword, "passkey", t);
    if (missing) {
      setProofError(missing);
      return;
    }
    setBusy(true);
    try {
      const before = await apiGet<{ passkeys: { id: string }[] }>("/api/auth/me");
      const known = new Set(before.passkeys.map((p) => p.id));
      const start = await apiPost<PasskeyStart>(
        "/api/auth/webauthn/register/options",
        reauthBody(proof, hasPassword, "code"),
      );
      setProof(emptyReauth);
      setFieldsKey((k) => k + 1);
      const { startRegistration } = await import("@simplewebauthn/browser");
      let response;
      try {
        response = await startRegistration({
          optionsJSON: start.options as Parameters<typeof startRegistration>[0]["optionsJSON"],
        });
      } catch (e) {
        setFailure(
          t(
            e instanceof Error && e.name === "NotAllowedError"
              ? "profile.mfa.add.passkey.cancelled"
              : "profile.mfa.add.passkey.error",
          ),
        );
        return;
      }
      await apiPost("/api/auth/webauthn/register/verify", {
        challengeToken: start.challengeToken,
        response,
      });
      onChanged();
      const after = await apiGet<{ passkeys: { id: string }[] }>("/api/auth/me");
      setPasskeyId(after.passkeys.find((p) => !known.has(p.id))?.id ?? null);
      setDeviceName(suggestDeviceName() || t("profile.mfa.add.passkey.defaultName"));
      setDoneKind("passkey");
      go("pkName");
    } catch (error) {
      if (handleProofError(error)) return;
      setFailure(t("profile.mfa.add.passkey.error"));
    } finally {
      setBusy(false);
    }
  }

  async function namePasskey() {
    if (busy) return;
    const name = deviceName.trim();
    if (!passkeyId || !name) {
      go("done");
      return;
    }
    setBusy(true);
    setFailure(undefined);
    try {
      await apiPatch(`/api/auth/webauthn/${passkeyId}`, { deviceName: name });
      onChanged();
      go("done");
    } catch {
      setFailure(t("profile.mfa.add.passkey.nameFailed"));
    } finally {
      setBusy(false);
    }
  }

  function submit() {
    if (step === "totpScan") afterScan();
    else if (step === "totpCodes") afterCodes();
    else if (step === "totpProof") void enableTotp();
    else if (step === "pkProof") void addPasskey();
    else if (step === "pkName") void namePasskey();
    else if (step === "done") close();
  }

  const isTotp = step.startsWith("totp");
  const isPasskey = step === "pkProof" || step === "pkName";
  const stepLabels = isTotp
    ? [
        t("profile.mfa.add.steps.scan"),
        ...(setup?.backupCodes ? [t("profile.mfa.add.steps.codes")] : []),
        t("profile.mfa.add.steps.confirm"),
      ]
    : [t("profile.mfa.add.steps.confirm"), t("profile.mfa.add.steps.name")];
  const current = isTotp
    ? step === "totpScan"
      ? 1
      : step === "totpCodes"
        ? 2
        : stepLabels.length
    : step === "pkProof"
      ? 1
      : 2;

  const heading: Record<Step, string> = {
    choose: t("profile.mfa.add.title"),
    pkProof: t("profile.mfa.add.passkey.title"),
    pkName: t("profile.mfa.add.passkey.nameTitle"),
    totpScan: t("profile.mfa.add.totp.title"),
    totpCodes: t("profile.mfa.add.codes.title"),
    totpProof: t("profile.mfa.add.confirm.title"),
    done: t("profile.mfa.add.done.title"),
  };

  const totpDisabled = totpSet;
  const passkeyDisabled = !supported;

  let actions;
  if (step === "choose") {
    actions = (
      <Button variant="secondary" onClick={() => close()}>
        {t("common.cancel")}
      </Button>
    );
  } else if (step === "done") {
    actions = <Button type="submit">{t("profile.mfa.add.done.close")}</Button>;
  } else {
    const back: Step | null =
      step === "pkProof"
        ? "choose"
        : step === "totpScan"
          ? "choose"
          : step === "totpCodes"
            ? "totpScan"
            : step === "totpProof"
              ? setup?.backupCodes
                ? "totpCodes"
                : "totpScan"
              : null;
    actions = (
      <>
        {back ? (
          <Button variant="secondary" onClick={() => go(back)} disabled={busy}>
            {t("common.back")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => go("done")} disabled={busy}>
            {t("profile.mfa.add.passkey.skipName")}
          </Button>
        )}
        <Button
          type="submit"
          loading={busy}
          disabled={(step === "totpProof" || step === "pkProof") && hasPassword === undefined}
        >
          {step === "totpProof"
            ? t("profile.mfa.add.confirm.submit")
            : step === "pkProof"
              ? t("profile.mfa.add.passkey.submit")
              : step === "pkName"
                ? t("profile.mfa.add.passkey.save")
                : t("profile.mfa.add.next")}
        </Button>
      </>
    );
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => close(next)}
      title={
        <span ref={headingRef} tabIndex={-1} className="ap-focus-target">
          {heading[step]}
        </span>
      }
      description={t("profile.mfa.add.description")}
      onSubmit={submit}
      actions={actions}
    >
      <div ref={bodyRef} className="ap-stack">
        {(isTotp || isPasskey) && <Stepper steps={stepLabels} current={current} />}
        {failure && <Banner tone="danger">{failure}</Banner>}

        {step === "choose" && (
          <>
            <p>{t("profile.mfa.add.intro")}</p>
            <div className="ap-stack ap-stack--sm">
              <Button
                variant="secondary"
                icon="shield"
                disabled={totpDisabled}
                loading={busy}
                aria-describedby="mfa-add-totp-hint"
                onClick={() => void startTotp()}
              >
                {t("profile.mfa.add.choose.totp")}
              </Button>
              <span id="mfa-add-totp-hint" className="cc-hint">
                {totpDisabled
                  ? t("profile.mfa.add.choose.totpSet")
                  : t("profile.mfa.add.choose.totpHint")}
              </span>
              <Button
                variant="secondary"
                icon="key"
                disabled={passkeyDisabled}
                aria-describedby="mfa-add-pk-hint"
                onClick={() => go("pkProof")}
              >
                {t("profile.mfa.add.choose.passkey")}
              </Button>
              <span id="mfa-add-pk-hint" className="cc-hint">
                {passkeyDisabled
                  ? t("profile.mfa.add.choose.unsupported")
                  : t("profile.mfa.add.choose.passkeyHint", { count: passkeyCount })}
              </span>
            </div>
          </>
        )}

        {step === "totpScan" && setup && (
          <>
            <p>{t("profile.mfa.add.totp.text")}</p>
            {setup.otpauthUri && (
              <QrCode value={setup.otpauthUri} alt={t("profile.mfa.add.totp.qrAlt")} />
            )}
            {setup.secret && (
              <CopyField
                label={t("profile.mfa.add.totp.manualKey")}
                value={setup.secret}
                hint={t("profile.mfa.add.totp.manualHint")}
              />
            )}
            <Field
              group
              id="mfa-add-code"
              label={t("profile.mfa.add.totp.codeLabel")}
              hint={t("profile.mfa.add.totp.codeHint")}
              error={codeError}
            >
              <CodeInput
                id="mfa-add-code"
                label={t("profile.mfa.add.totp.codeLabel")}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  setCodeError(undefined);
                }}
                invalid={!!codeError}
                describedBy={codeError ? "mfa-add-code-error" : undefined}
              />
            </Field>
          </>
        )}

        {step === "totpCodes" && setup?.backupCodes && (
          <>
            <p>{t("profile.mfa.add.codes.text")}</p>
            <ul className="ap-code" translate="no" style={{ listStyle: "none", padding: 0 }}>
              {setup.backupCodes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <div className="ap-actions">
              <Button
                variant="secondary"
                icon="copy"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(setup.backupCodes!.join("\n"))
                    .then(() => toast.success(t("profile.mfa.add.codes.copied")))
                    .catch(() => toast.error(t("profile.mfa.add.codes.copyFailed")));
                }}
              >
                {t("profile.mfa.add.codes.copy")}
              </Button>
              <Button
                variant="secondary"
                icon="download"
                onClick={() => downloadCodes(setup.backupCodes!)}
              >
                {t("profile.mfa.add.codes.download")}
              </Button>
            </div>
            <div className="ap-stack ap-stack--sm">
              <label className="ap-row" style={{ gap: 8 }}>
                <input
                  id="mfa-add-ack"
                  type="checkbox"
                  checked={acknowledged}
                  aria-invalid={!!ackError}
                  aria-describedby={ackError ? "mfa-add-ack-error" : undefined}
                  onChange={(e) => {
                    setAcknowledged(e.target.checked);
                    setAckError(undefined);
                  }}
                />
                {t("profile.mfa.add.codes.ack")}
              </label>
              {ackError && (
                <span id="mfa-add-ack-error" className="cc-hint cc-hint--error">
                  {ackError}
                </span>
              )}
            </div>
          </>
        )}

        {step === "totpProof" && (
          <>
            <p>{t("profile.mfa.add.confirm.text")}</p>
            <ReauthFields
              key={fieldsKey}
              purpose="mfa"
              idPrefix="mfa-add"
              hasPassword={hasPassword}
              email={email}
              value={proof}
              onChange={setProof}
              error={proofError}
              busy={busy}
            />
          </>
        )}

        {step === "pkProof" && (
          <>
            <p>{t("profile.mfa.add.passkey.text")}</p>
            <ReauthFields
              key={fieldsKey}
              purpose="passkey"
              idPrefix="mfa-add-pk"
              hasPassword={hasPassword}
              email={email}
              value={proof}
              onChange={setProof}
              error={proofError}
              busy={busy}
            />
          </>
        )}

        {step === "pkName" && (
          <>
            <Banner tone="success">{t("profile.mfa.add.passkey.created")}</Banner>
            <Field id="mfa-add-name" label={t("profile.mfa.add.passkey.nameLabel")}>
              <TextInput
                value={deviceName}
                maxLength={80}
                autoComplete="off"
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </Field>
          </>
        )}

        {step === "done" && (
          <p role="status" className="ap-row" style={{ gap: 8 }}>
            <Icon glyph="check" size={20} />
            {t(doneKind === "totp" ? "profile.mfa.add.done.totp" : "profile.mfa.add.done.passkey")}
          </p>
        )}
      </div>
    </FormDialog>
  );
}
