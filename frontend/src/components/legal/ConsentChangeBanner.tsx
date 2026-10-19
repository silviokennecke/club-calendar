import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost, apiErrorCode } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { legalKeys, useLegalVersion } from "@/lib/legal";
import type { User } from "@/lib/types";
import { Banner, Button, FormDialog } from "@/components/ui/shared";
import { ConsentCheckboxes, type ConsentItem } from "./ConsentCheckboxes";
import { LegalDocumentView } from "./LegalDocumentView";

const STORAGE_KEY = "consent-banner-dismissed";

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissed(key: string) {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // storage unavailable: the banner only stays dismissed until the next render
  }
}

/** A further new version has other ids, so it shows the banner again. */
function dismissKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

function DocumentPanel({ id }: { id: string }) {
  const q = useLegalVersion(id);
  return <LegalDocumentView document={q.data} loading={q.isLoading} error={q.error} />;
}

/**
 * Documents changed during a running session (`pendingConsents` without `consentRequired`): a
 * dismissible banner offers review and acceptance; the sign-in gate follows at the latest at the next
 * login. Documents open inside the dialog (a routed legal modal cannot stack on a dialog).
 */
export function ConsentChangeBanner({ standalone }: { standalone?: boolean }) {
  const { t } = useTranslation();
  const { user, setUser, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const pending = user?.pendingConsents ?? [];
  const key = dismissKey(pending.map((d) => d.id));
  const [dismissed, setDismissed] = useState<string | null>(readDismissed);
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [problem, setProblem] = useState<"generic" | "outdated" | null>(null);
  const [viewing, setViewing] = useState<ConsentItem | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user || pending.length === 0 || user.consentRequired) return null;
  if (dismissed === key && !open) return null;

  const names = pending.map((d) => t(`consent.banner.type.${d.type}`)).join(", ");

  function close() {
    setOpen(false);
    setViewing(null);
    setProblem(null);
    setErrors({});
  }

  async function submit() {
    setProblem(null);
    const missing: Record<string, string> = {};
    for (const doc of pending) {
      if (!accepted.has(doc.id)) missing[doc.id] = t(`consent.required.${doc.type}`);
    }
    setErrors(missing);
    const first = pending.find((d) => missing[d.id]);
    if (first) {
      document.getElementById(`consent-banner-${first.type}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const me = await apiPost<User>("/api/auth/consents", {
        documentIds: pending.map((d) => d.id),
      });
      setUser(me);
      void queryClient.invalidateQueries({ queryKey: legalKeys.consents });
      close();
    } catch (err) {
      if (apiErrorCode(err) === "consent_outdated") {
        setAccepted(new Set());
        try {
          await refreshUser();
        } catch {
          // keep the list; the next try reports the problem
        }
        setProblem("outdated");
      } else {
        setProblem("generic");
      }
    } finally {
      setBusy(false);
    }
  }

  const banner = (
    <Banner
      tone="info"
      icon="shield"
      title={t("consent.banner.title")}
      action={
        <div className="ap-row">
          <Button onClick={() => setOpen(true)}>{t("consent.banner.review")}</Button>
          <Button
            variant="ghost"
            onClick={() => {
              writeDismissed(key);
              setDismissed(key);
            }}
          >
            {t("consent.banner.later")}
          </Button>
        </div>
      }
    >
      {t("consent.banner.text", { documents: names })}
    </Banner>
  );

  const viewingDoc = viewing ? pending.find((d) => d.id === viewing.id) : undefined;

  return (
    <>
      {dismissed !== key && (
        <div
          className={standalone ? "ap-wrap" : undefined}
          style={
            standalone
              ? { padding: "var(--space-4) var(--space-4) 0" }
              : { marginBottom: "var(--space-4)" }
          }
        >
          {banner}
        </div>
      )}
      {open && viewing ? (
        <FormDialog
          open
          onOpenChange={(o) => !o && close()}
          title={t(`consent.banner.type.${viewing.type}`)}
          description={t("consent.banner.viewDescription")}
          onSubmit={() => setViewing(null)}
          actions={
            <Button type="submit" variant="secondary">
              {t("consent.banner.back")}
            </Button>
          }
          wide
        >
          {viewingDoc && <DocumentPanel id={viewingDoc.id} />}
        </FormDialog>
      ) : (
        <FormDialog
          open={open}
          onOpenChange={(o) => !o && close()}
          title={t("consent.banner.dialogTitle")}
          description={t("consent.banner.dialogDescription")}
          onSubmit={() => void submit()}
          actions={
            <>
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>
                {t("consent.banner.cancel")}
              </Button>
              <Button type="submit" loading={busy} loadingLabel={t("consent.accepting")}>
                {t("consent.accept.button")}
              </Button>
            </>
          }
        >
          {problem && (
            <Banner tone="danger" title={t("consent.errorTitle")}>
              {t(problem === "outdated" ? "consent.outdated" : "consent.failed")}
            </Banner>
          )}
          <ConsentCheckboxes
            items={pending}
            idPrefix="consent-banner"
            checked={accepted}
            errors={errors}
            disabled={busy}
            onOpenDocument={setViewing}
            onToggle={(id, on) => {
              setAccepted((prev) => {
                const next = new Set(prev);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              });
              setErrors((prev) => ({ ...prev, [id]: undefined }));
            }}
          />
        </FormDialog>
      )}
    </>
  );
}
