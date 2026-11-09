import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import { Banner, Button, PasswordField, toast } from "@/components/ui/shared";
import { ApiError, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { focusFirstInvalid } from "@/lib/focus";
import { passwordProblem } from "@/lib/password";
import {
  OPAQUE_FAILURE_TEXT,
  opaqueChangePassword,
  opaqueFailureKind,
  usePasswordProof,
} from "@/lib/opaque";
import { requestPasswordReset } from "@/lib/passwordReset";
import type { User } from "@/lib/types";
import type { ProfileData } from "./profileTypes";

interface Errors {
  current?: string;
  next?: string;
  confirm?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

/**
 * "Passwort" (not in the design Profile; same panel style). With a password: change it with the
 * current one; the API ends all other sessions and returns new tokens for this one. SSO-only accounts
 * set a password by e-mail: the reset link of "Passwort vergessen" goes to the account's own address
 * (proves the mailbox; no password change without the old password or the mailbox).
 */
export function PasswordSection({ profile }: { profile: ProfileData }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { login } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failed, setFailed] = useState<string | null>(null);
  const proof = usePasswordProof("change-password");
  const [saving, setSaving] = useState(false);
  const [linkState, setLinkState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  // A failed submit (client check or server answer) moves focus to the first invalid field.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => focusFirstInvalid(formRef.current), [errors]);

  async function change(e: React.FormEvent) {
    e.preventDefault();
    setFailed(null);
    const found: Errors = {};
    if (!current) found.current = t("profile.account.passwordMissing");
    const problem = passwordProblem(next);
    if (problem) found.next = t(`auth.reset.password.${problem}`);
    else if (confirm !== next) found.confirm = t("auth.register.confirmMismatchField");
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      // OPAQUE accounts prove the current password with a ticket and register the new one locally
      const p = await proof(current);
      const tokens =
        "reauthTicket" in p
          ? await opaqueChangePassword(p.reauthTicket, next)
          : await apiPost<TokenResponse>("/api/auth/change-password", {
              currentPassword: current,
              newPassword: next,
            });
      // All sessions ended on the server; this one continues with the new tokens.
      login(tokens.access_token, tokens.refresh_token, tokens.user);
      setCurrent("");
      setNext("");
      setConfirm("");
      await qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success(t("profile.password.changed"));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "invalid_credentials")
        setErrors({ current: t("profile.account.wrongPassword") });
      else if (code === "validation_failed") setErrors({ next: t("auth.reset.password.short") });
      else {
        const kind = opaqueFailureKind(err);
        setFailed(kind ? t(OPAQUE_FAILURE_TEXT[kind]) : t("profile.password.failed"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function sendLink() {
    setLinkState("sending");
    const result = await requestPasswordReset(profile.email);
    setLinkState(result === "sent" ? "sent" : "failed");
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-pw">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-pw">
            {t("profile.password.title")}
          </h2>
          <p>{profile.hasPassword ? t("profile.password.text") : t("profile.password.noneText")}</p>
        </div>
      </div>
      {profile.hasPassword ? (
        <form
          ref={formRef}
          className="ap-form"
          aria-labelledby="pr-pw"
          onSubmit={change}
          noValidate
        >
          {failed && <Banner tone="danger">{failed}</Banner>}
          <PasswordField
            label={t("profile.account.currentPassword")}
            requiredLabel
            error={errors.current}
            value={current}
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
          <PasswordField
            label={t("auth.reset.newPassword")}
            requiredLabel
            hint={t("auth.register.passwordHint")}
            error={errors.next}
            value={next}
            autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)}
          />
          <PasswordField
            label={t("auth.register.confirmPassword")}
            requiredLabel
            error={errors.confirm}
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)}
          />
          <p className="t-sm">{t("profile.password.signOutHint")}</p>
          <div className="ap-actions">
            <Button type="submit" variant="secondary" icon="key" loading={saving}>
              {t("profile.password.submit")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="ap-stack">
          {linkState === "sent" && (
            <Banner tone="success" title={t("profile.password.linkSentTitle")}>
              <Trans
                i18nKey="profile.password.linkSentText"
                values={{ email: profile.email }}
                components={{ strong: <strong /> }}
              />
            </Banner>
          )}
          {linkState === "failed" && (
            <Banner tone="danger">{t("profile.password.linkFailed")}</Banner>
          )}
          <div className="ap-actions">
            <Button
              variant="secondary"
              icon="mail"
              loading={linkState === "sending"}
              onClick={() => void sendLink()}
            >
              {t("profile.password.setByMail")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
