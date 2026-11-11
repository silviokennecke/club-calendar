import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Banner, Button, Icon, TextInput, toast } from "@/components/ui/shared";
import { apiErrorCode } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { localDay } from "@/lib/profile";
import { useDeletePasskey, useRenamePasskey } from "@/lib/profile/mfa";
import { BackupCodesDialog } from "./BackupCodesDialog";
import { MfaAddDialog } from "./MfaAddDialog";
import { MfaDisableDialog } from "./MfaDisableDialog";
import { MfaEnforceDialog } from "./MfaEnforceDialog";
import { MfaProofDialog } from "./MfaProofDialog";
import type { PasskeyInfo, ProfileData } from "./profileTypes";

/**
 * "Zwei-Faktor-Authentifizierung (MFA)": one row per method (authenticator app, each passkey, backup
 * codes), add button, and enforce / disable. Replaces the former passkey section.
 */
export function MfaSection({ profile }: { profile: ProfileData }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";
  const { mfa, passkeys, hasPassword, email } = profile;
  const rename = useRenamePasskey();
  const deletePasskey = useDeletePasskey();
  const [addOpen, setAddOpen] = useState(false);
  const [enforceOpen, setEnforceOpen] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [codesOpen, setCodesOpen] = useState(false);
  const [removing, setRemoving] = useState<PasskeyInfo | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [renameFailed, setRenameFailed] = useState(false);
  const nameOf = (k: PasskeyInfo) => k.deviceName || t("profile.mfa.unnamed");

  async function saveRename() {
    if (!renaming) return;
    setRenameFailed(false);
    try {
      await rename.mutateAsync({ id: renaming.id, deviceName: renaming.value.trim() });
      setRenaming(null);
      toast.success(t("profile.mfa.renamed"));
    } catch {
      setRenameFailed(true);
    }
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-mfa">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2 ap-focus-target" id="pr-mfa" tabIndex={-1}>
            {t("profile.mfa.title")}
          </h2>
          <p>{t("profile.mfa.text")}</p>
        </div>
      </div>
      <div className="ap-stack">
        <p className="t-body">
          <b>{mfa.enforced ? t("profile.mfa.statusOn") : t("profile.mfa.statusOff")}</b>
        </p>
        {renameFailed && <Banner tone="danger">{t("profile.mfa.renameFailed")}</Banner>}

        {!mfa.totp && passkeys.length === 0 && !mfa.backupCodes ? (
          <p className="t-body t-muted">{t("profile.mfa.none")}</p>
        ) : (
          <ul
            className="ap-list"
            style={{ listStyle: "none", margin: 0, padding: 0 }}
            aria-label={t("profile.mfa.listLabel")}
          >
            {mfa.totp && (
              <li className="ap-listrow">
                <span style={{ flex: "none", display: "inline-flex" }}>
                  <Icon glyph="smartphone" size={22} />
                </span>
                <div className="ap-listrow-main">
                  <b>{t("profile.mfa.totpName")}</b>
                  <span>
                    {t("profile.mfa.addedOn", {
                      date: formatDate(localDay(mfa.totp.createdAt), dateFormat),
                    })}
                  </span>
                </div>
              </li>
            )}
            {passkeys.map((k) => (
              <li key={k.id} className="ap-listrow">
                <span style={{ flex: "none", display: "inline-flex" }}>
                  <Icon glyph="key" size={22} />
                </span>
                {renaming?.id === k.id ? (
                  <form
                    className="ap-row"
                    style={{ flex: 1, gap: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveRename();
                    }}
                  >
                    <TextInput
                      aria-label={t("profile.mfa.renameField")}
                      value={renaming.value}
                      maxLength={80}
                      autoFocus
                      autoComplete="off"
                      onChange={(e) => setRenaming({ id: k.id, value: e.target.value })}
                    />
                    <Button type="submit" loading={rename.isPending}>
                      {t("profile.mfa.renameSave")}
                    </Button>
                    <Button variant="secondary" onClick={() => setRenaming(null)}>
                      {t("common.cancel")}
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="ap-listrow-main">
                      <b>{nameOf(k)}</b>
                      <span>
                        {t("profile.mfa.addedOn", {
                          date: formatDate(localDay(k.createdAt), dateFormat),
                        })}
                        {" · "}
                        {k.lastUsedAt
                          ? t("profile.mfa.lastUsed", {
                              date: formatDate(localDay(k.lastUsedAt), dateFormat),
                            })
                          : t("profile.mfa.neverUsed")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      icon="edit"
                      aria-label={t("profile.mfa.renameLabel", { name: nameOf(k) })}
                      onClick={() => {
                        setRenameFailed(false);
                        setRenaming({ id: k.id, value: k.deviceName ?? "" });
                      }}
                    >
                      {t("profile.mfa.rename")}
                    </Button>
                    <Button
                      variant="ghost-danger"
                      icon="trash"
                      aria-label={t("profile.mfa.removeLabel", { name: nameOf(k) })}
                      onClick={() => setRemoving(k)}
                    >
                      {t("profile.mfa.remove")}
                    </Button>
                  </>
                )}
              </li>
            ))}
            {mfa.backupCodes && (
              <li className="ap-listrow">
                <span style={{ flex: "none", display: "inline-flex" }}>
                  <Icon glyph="list" size={22} />
                </span>
                <div className="ap-listrow-main">
                  <b>{t("profile.mfa.backupName")}</b>
                  <span>{t("profile.mfa.backupRemaining", { n: mfa.backupCodes.remaining })}</span>
                </div>
                <Button variant="secondary" icon="refresh" onClick={() => setCodesOpen(true)}>
                  {t("profile.mfa.regenerate.action")}
                </Button>
              </li>
            )}
          </ul>
        )}

        <div className="ap-actions">
          <Button icon="plus" onClick={() => setAddOpen(true)}>
            {t("profile.mfa.addButton")}
          </Button>
          {mfa.enforced ? (
            <Button variant="ghost-danger" icon="unlink" onClick={() => setDisableOpen(true)}>
              {t("profile.mfa.disable.action")}
            </Button>
          ) : (
            mfa.canEnforce && (
              <Button variant="secondary" icon="lock" onClick={() => setEnforceOpen(true)}>
                {t("profile.mfa.enforce.action")}
              </Button>
            )
          )}
        </div>
      </div>

      <MfaAddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onChanged={() => void qc.invalidateQueries({ queryKey: ["profile"] })}
        hasPassword={hasPassword}
        email={email}
        totpSet={!!mfa.totp}
        enforced={mfa.enforced}
        passkeyCount={passkeys.length}
      />
      <MfaEnforceDialog
        open={enforceOpen}
        onClose={() => setEnforceOpen(false)}
        hasPassword={hasPassword}
        email={email}
      />
      <MfaDisableDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        hasPassword={hasPassword}
        email={email}
        hasTotp={!!mfa.totp}
      />
      <BackupCodesDialog
        open={codesOpen}
        onClose={() => setCodesOpen(false)}
        hasPassword={hasPassword}
        email={email}
      />
      {removing && (
        <MfaProofDialog
          open
          onClose={() => setRemoving(null)}
          title={t("profile.mfa.removeTitle", { name: nameOf(removing) })}
          submitLabel={t("profile.mfa.removeConfirm")}
          danger
          hasPassword={hasPassword}
          email={email}
          failureText={(e) =>
            apiErrorCode(e) === "mfa_last_passkey" ? t("profile.mfa.lastPasskey") : undefined
          }
          onSubmit={async (proof) => {
            await deletePasskey.mutateAsync({ id: removing.id, proof });
            toast.success(t("profile.mfa.removed", { name: nameOf(removing) }));
            setRemoving(null);
          }}
        >
          <p>{t("profile.mfa.removeText", { name: nameOf(removing) })}</p>
        </MfaProofDialog>
      )}
    </section>
  );
}
