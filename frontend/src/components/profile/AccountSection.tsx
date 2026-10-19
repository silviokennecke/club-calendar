import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  Field,
  PasswordField,
  TextInput,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { ApiError, apiDelete, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { focusFirstInvalid } from "@/lib/focus";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import type { ProfileData } from "./profileTypes";

const NAME_MAX = 255;

/**
 * "Name und E-Mail-Adresse" (extends design Profile, which only showed both read-only): rename at once;
 * a new address needs the current password and only takes effect when the link sent to it is opened
 * (pending state with "Änderung verwerfen"). SSO-only accounts have no password to confirm with, so
 * they first set one (password panel). The API answers the same whether or not the new address is
 * free, so the success text never claims that a mail was sent for sure.
 */
export function AccountSection({ profile }: { profile: ProfileData }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { updateUser } = useAuth();
  const [name, setName] = useState(profile.name);
  const [nameError, setNameError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailErrors, setEmailErrors] = useState<{ email?: string; password?: string }>({});
  const [emailFailed, setEmailFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const unsaved = useUnsavedChanges(name !== profile.name || email !== "" || password !== "");

  // A failed submit (client check or server answer) moves focus to the first invalid field.
  const nameForm = useRef<HTMLFormElement>(null);
  const emailForm = useRef<HTMLFormElement>(null);
  useEffect(() => focusFirstInvalid(nameForm.current), [nameError]);
  useEffect(() => focusFirstInvalid(emailForm.current), [emailErrors]);

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setNameError(t("profile.account.nameMissing"));
    if ([...trimmed].length > NAME_MAX) return setNameError(t("profile.account.nameTooLong"));
    setNameError("");
    setSavingName(true);
    const ok = await updateUser({ name: trimmed });
    setSavingName(false);
    if (!ok) {
      toast.error(t("profile.account.nameFailed"));
      return;
    }
    setName(trimmed);
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success(t("profile.account.nameSaved"));
  }

  async function requestChange(e: React.FormEvent) {
    e.preventDefault();
    setEmailFailed(false);
    const found: { email?: string; password?: string } = {};
    if (!email.trim()) found.email = t("auth.register.emailMissing");
    if (!password) found.password = t("profile.account.passwordMissing");
    setEmailErrors(found);
    if (Object.keys(found).length > 0) return;

    setSending(true);
    try {
      await apiPost<void>("/api/auth/change-email", { email: email.trim(), password });
      setEmail("");
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined;
      if (code === "invalid_credentials")
        setEmailErrors({ password: t("profile.account.wrongPassword") });
      else if (code === "validation_failed")
        setEmailErrors({ email: t("profile.account.emailInvalid") });
      else setEmailFailed(true);
    } finally {
      setSending(false);
    }
  }

  async function cancelChange() {
    try {
      await apiDelete("/api/auth/change-email");
    } catch {
      toast.error(t("profile.account.cancelFailed"));
      return;
    }
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success(t("profile.account.cancelled"));
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-account">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="pr-account">
            {t("profile.account.title")}
          </h2>
          <p>{t("profile.account.text")}</p>
        </div>
      </div>
      <div className="ap-stack ap-stack--lg">
        <form
          ref={nameForm}
          className="ap-form"
          aria-labelledby="pr-name"
          onSubmit={saveName}
          noValidate
        >
          <h3 className="t-h3" id="pr-name">
            {t("profile.account.nameTitle")}
          </h3>
          <Field label={t("profile.account.nameLabel")} required error={nameError}>
            <TextInput value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="ap-actions">
            <Button type="submit" variant="secondary" loading={savingName}>
              {t("profile.account.nameSave")}
            </Button>
          </div>
        </form>

        <form
          ref={emailForm}
          className="ap-form"
          aria-labelledby="pr-email"
          onSubmit={requestChange}
          noValidate
        >
          <h3 className="t-h3" id="pr-email">
            {t("profile.account.emailTitle")}
          </h3>
          <p className="t-body">
            <Trans
              i18nKey="profile.account.emailCurrent"
              values={{ email: profile.email }}
              components={{ strong: <strong /> }}
            />
          </p>
          {profile.pendingEmail && (
            <Banner
              tone="info"
              icon="mail"
              title={t("profile.account.pendingTitle")}
              action={
                <Button type="button" variant="secondary" onClick={() => void cancelChange()}>
                  {t("profile.account.cancel")}
                </Button>
              }
            >
              <Trans
                i18nKey="profile.account.pendingText"
                values={{ email: profile.pendingEmail }}
                components={{ strong: <strong /> }}
              />
            </Banner>
          )}
          {emailFailed && <Banner tone="danger">{t("profile.account.emailFailed")}</Banner>}
          {profile.hasPassword ? (
            <>
              <Field
                label={t("profile.account.newEmail")}
                required
                error={emailErrors.email}
                hint={t("profile.account.newEmailHint")}
              >
                <TextInput
                  type="email"
                  value={email}
                  autoComplete="email"
                  inputMode="email"
                  spellCheck={false}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <PasswordField
                label={t("profile.account.currentPassword")}
                requiredLabel
                error={emailErrors.password}
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="ap-actions">
                <Button type="submit" variant="secondary" icon="send" loading={sending}>
                  {t("profile.account.emailSubmit")}
                </Button>
              </div>
            </>
          ) : (
            <p className="t-sm">{t("profile.account.emailNeedsPassword")}</p>
          )}
        </form>
      </div>
      <UnsavedChangesDialog {...unsaved.dialog} />
    </section>
  );
}
