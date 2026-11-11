import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { apiErrorCode } from "@/lib/api";
import { focusFirstInvalid } from "@/lib/focus";
import type { Proof } from "@/lib/profile/mfa";
import { ReauthFields } from "./ReauthFields";
import { emptyReauth, reauthBody, reauthFieldError, reauthMissing } from "./reauth";

interface MfaProofDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Explanation above the proof fields. */
  children?: ReactNode;
  submitLabel: string;
  danger?: boolean;
  hasPassword: boolean | undefined;
  email: string;
  /** Throws an ApiError on failure; a wrong proof is shown at the field. */
  onSubmit: (proof: Proof) => Promise<unknown>;
  /** Text for errors other than a wrong proof (default: generic failure). */
  failureText?: (error: unknown) => string | undefined;
}

/** Dialog that asks for the password / mailed code (purpose `mfa`) before a sensitive MFA action. */
export function MfaProofDialog({
  open,
  onClose,
  title,
  children,
  submitLabel,
  danger,
  hasPassword,
  email,
  onSubmit,
  failureText,
}: MfaProofDialogProps) {
  const { t } = useTranslation();
  const [proof, setProof] = useState(emptyReauth);
  const [fieldError, setFieldError] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => focusFirstInvalid(formRef.current), [fieldError]);

  function close() {
    setProof(emptyReauth);
    setFieldError(undefined);
    setFailure(undefined);
    onClose();
  }

  async function submit() {
    if (busy || hasPassword === undefined) return;
    setFieldError(undefined);
    setFailure(undefined);
    const missing = reauthMissing(proof, hasPassword, "mfa", t);
    if (missing) {
      setFieldError(missing);
      return;
    }
    setBusy(true);
    try {
      await onSubmit(reauthBody(proof, hasPassword) as Proof);
      setProof(emptyReauth);
    } catch (error) {
      const wrong = reauthFieldError(error, "mfa", t);
      if (wrong) setFieldError(wrong);
      else if (apiErrorCode(error) === "rate_limited") setFailure(t("profile.mfa.rateLimited"));
      else setFailure(failureText?.(error) ?? t("profile.mfa.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={title}
      description={title}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={hasPassword === undefined}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="ap-stack">
        {children}
        {failure && <Banner tone="danger">{failure}</Banner>}
        <ReauthFields
          purpose="mfa"
          hasPassword={hasPassword}
          email={email}
          value={proof}
          onChange={setProof}
          error={fieldError}
          busy={busy}
        />
      </div>
    </FormDialog>
  );
}
