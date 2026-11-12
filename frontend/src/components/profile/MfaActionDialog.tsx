import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { apiErrorCode, isStepUpCancelled } from "@/lib/api";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";

interface MfaActionDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Explanation of the action. */
  children?: ReactNode;
  submitLabel: string;
  danger?: boolean;
  /** Throws an ApiError on failure. The step-up confirmation is requested by the API layer. */
  onSubmit: () => Promise<unknown>;
  /** Text for errors (default: generic failure). */
  failureText?: (error: unknown) => string | undefined;
}

/** Confirm dialog of a sensitive MFA action; the identity proof is the shared step-up dialog. */
export function MfaActionDialog({
  open,
  onClose,
  title,
  children,
  submitLabel,
  danger,
  onSubmit,
  failureText,
}: MfaActionDialogProps) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  function close() {
    setFailure(undefined);
    onClose();
  }

  async function submit() {
    if (busy) return;
    setFailure(undefined);
    setBusy(true);
    try {
      await onSubmit();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      if (isRateLimited(error)) setFailure(rateLimitText(t, error));
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
          <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="ap-stack">
        {children}
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </FormDialog>
  );
}
