import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  Field,
  Icon,
  TextInput,
  toast,
} from "@/components/ui/shared";
import { apiDelete, apiFetch, type TokenResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { focusAfterDialog } from "@/lib/focus";
import { localDay } from "@/lib/profile";
import type { PasskeyInfo } from "./profileTypes";

type Result = { kind: "success"; name: string } | { kind: "error" } | { kind: "cancelled" } | null;

/** Browser support check without loading the WebAuthn library. */
function passkeysSupported() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

/**
 * "Passkeys" panel (design: Profile): list with remove (confirmed), and "Neuen Passkey hinzufügen"
 * with an optional device name. The result is announced in a banner (success, failure, cancelled).
 */
export function PasskeysSection({
  passkeys,
  refresh,
}: {
  passkeys: PasskeyInfo[];
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user, login } = useAuth();
  const [deviceName, setDeviceName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  const supported = passkeysSupported();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";
  const nameOf = (key: PasskeyInfo) => key.deviceName || t("profile.passkeys.unnamed");

  async function register() {
    setRegistering(true);
    setResult(null);
    const name = deviceName.trim() || t("profile.passkeys.thisDevice");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optRes = await apiFetch("/api/auth/webauthn/register/options");
      if (!optRes.ok) throw new Error("options");
      const { options, challengeToken } = (await optRes.json()) as {
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
        challengeToken: string;
      };
      const response = await startRegistration({ optionsJSON: options });
      const verifyRes = await apiFetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, response, deviceName: name }),
      });
      if (!verifyRes.ok) throw new Error("verify");
      setDeviceName("");
      setResult({ kind: "success", name });
      await refresh();
    } catch (e) {
      const errorName = e instanceof Error ? e.name : "";
      // The user dismissed the system dialog (or it timed out): not an error of the device.
      setResult({ kind: errorName === "NotAllowedError" ? "cancelled" : "error" });
    } finally {
      setRegistering(false);
    }
  }

  async function remove(key: PasskeyInfo) {
    try {
      // Removing a passkey ends all sessions on the server; this one continues with the fresh tokens.
      const tokens = await apiDelete<Partial<TokenResponse> | undefined>(
        `/api/auth/webauthn/${key.id}`,
      );
      if (tokens?.access_token && tokens.refresh_token && tokens.user)
        login(tokens.access_token, tokens.refresh_token, tokens.user);
    } catch {
      toast.error(t("profile.passkeys.removeFailed"));
      return;
    }
    setResult(null);
    await qc.invalidateQueries({ queryKey: ["profile"] });
    toast.success(t("profile.passkeys.removed", { name: nameOf(key) }));
    focusAfterDialog("pr-pk");
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-pk">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-focus-target" id="pr-pk" tabIndex={-1}>
            {t("profile.passkeys.title")}
          </h2>
          <p>{t("profile.passkeys.text")}</p>
        </div>
      </div>
      <div className="ap-stack">
        {result?.kind === "success" && (
          <Banner tone="success">{t("profile.passkeys.added", { name: result.name })}</Banner>
        )}
        {result?.kind === "error" && <Banner tone="danger">{t("profile.passkeys.error")}</Banner>}
        {result?.kind === "cancelled" && (
          <Banner tone="info">{t("profile.passkeys.cancelled")}</Banner>
        )}

        {passkeys.length === 0 ? (
          <p className="t-body t-muted">{t("profile.passkeys.none")}</p>
        ) : (
          <ul
            className="ap-list"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label={t("profile.passkeys.listLabel", { count: passkeys.length })}
          >
            {passkeys.map((k) => (
              <li key={k.id} className="ap-listrow">
                <span style={{ flex: "none", display: "inline-flex" }}>
                  <Icon glyph="key" size={22} />
                </span>
                <div className="ap-listrow-main">
                  <b>{nameOf(k)}</b>
                  <span>
                    {t("profile.passkeys.addedOn", { date: formatDate(k.createdAt, dateFormat) })}
                    {" · "}
                    {k.lastUsedAt
                      ? t("profile.passkeys.lastUsed", {
                          date: formatDate(localDay(k.lastUsedAt), dateFormat),
                        })
                      : t("profile.passkeys.neverUsed")}
                  </span>
                </div>
                <Button
                  variant="ghost-danger"
                  icon="trash"
                  aria-label={t("profile.passkeys.removeLabel", { name: nameOf(k) })}
                  onClick={() => setRemoving(k)}
                >
                  {t("profile.passkeys.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="ap-form" role="group" aria-labelledby="pr-pk-new">
          <h3 className="t-h3" id="pr-pk-new">
            {t("profile.passkeys.addTitle")}
          </h3>
          {!supported && <Banner tone="warning">{t("profile.passkeys.unsupported")}</Banner>}
          <Field
            id="pr-pkname"
            label={t("profile.passkeys.deviceLabel")}
            optional
            hint={t("profile.passkeys.deviceHint")}
          >
            <TextInput
              value={deviceName}
              maxLength={80}
              autoComplete="off"
              placeholder={t("profile.passkeys.devicePlaceholder")}
              onChange={(e) => setDeviceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && supported && !registering) {
                  e.preventDefault();
                  void register();
                }
              }}
            />
          </Field>
          <div className="ap-actions">
            <Button
              icon="shield"
              loading={registering}
              loadingLabel={t("profile.passkeys.waiting")}
              disabled={!supported}
              onClick={() => void register()}
            >
              {t("profile.passkeys.add")}
            </Button>
          </div>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          icon="key"
          title={t("profile.passkeys.removeTitle", { name: nameOf(removing) })}
          description={t("profile.passkeys.removeText", { name: nameOf(removing) })}
          consequence={t("profile.passkeys.removeConsequence")}
          confirmLabel={t("profile.passkeys.removeConfirm")}
          onConfirm={() => remove(removing)}
        />
      )}
    </section>
  );
}
