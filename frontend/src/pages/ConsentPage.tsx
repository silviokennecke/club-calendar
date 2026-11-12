import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { legalKeys } from "@/lib/legal";
import { apiGet, apiPost, apiErrorCode } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { User } from "@/lib/types";
import { Banner, Button } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { ConsentCheckboxes } from "@/components/legal/ConsentCheckboxes";
import { ConsentHistoryDialog } from "@/components/legal/ConsentHistoryList";
import { DeleteAccountDialog } from "@/components/profile/DeleteAccountDialog";

/**
 * Consent gate (rendered by ProtectedRoute while `user.consentRequired`): the user accepts the current
 * version of every pending document before the app opens. Also covers documents that were updated later.
 */
export default function ConsentPage() {
  const { t } = useTranslation();
  const { user, setUser, logout } = useAuth();
  const queryClient = useQueryClient();
  const pending = user?.pendingConsents ?? [];
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [problem, setProblem] = useState<"generic" | "outdated" | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  function accountDeleted() {
    logout();
    navigate("/login", { replace: true });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    const missing: Record<string, string> = {};
    for (const doc of pending) {
      if (!accepted.has(doc.id)) missing[doc.id] = t(`consent.required.${doc.type}`);
    }
    setErrors(missing);
    const firstMissing = pending.find((d) => missing[d.id]);
    if (firstMissing) {
      document.getElementById(`consent-${firstMissing.type}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const me = await apiPost<User>("/api/auth/consents", {
        documentIds: pending.map((d) => d.id),
      });
      setUser(me);
      void queryClient.invalidateQueries({ queryKey: legalKeys.consents });
    } catch (err) {
      if (apiErrorCode(err) === "consent_outdated") {
        // a newer version was published meanwhile: show the current list
        setAccepted(new Set());
        try {
          setUser(await apiGet<User>("/api/auth/me"));
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

  return (
    <AuthLayout icon="shield" title={t("consent.title")} intro={t("consent.intro")}>
      <form className="ap-form" onSubmit={submit} noValidate aria-label={t("consent.title")}>
        {problem && (
          <Banner tone="danger" title={t("consent.errorTitle")}>
            {t(problem === "outdated" ? "consent.outdated" : "consent.failed")}
          </Banner>
        )}
        <ConsentCheckboxes
          items={pending}
          idPrefix="consent"
          checked={accepted}
          errors={errors}
          disabled={busy}
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
        <Button type="submit" block loading={busy} loadingLabel={t("consent.accepting")}>
          {t("consent.accept.button")}
        </Button>
        <Button type="button" block variant="ghost" disabled={busy} onClick={logout}>
          {t("consent.signOut")}
        </Button>
        <Button
          type="button"
          block
          variant="ghost"
          icon="clock"
          disabled={busy}
          onClick={() => setHistoryOpen(true)}
        >
          {t("consent.showHistory")}
        </Button>
        <Button
          type="button"
          block
          variant="ghost-danger"
          icon="trash"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
        >
          {t("consent.deleteAccount")}
        </Button>
      </form>
      {historyOpen && <ConsentHistoryDialog onClose={() => setHistoryOpen(false)} />}
      <DeleteAccountDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={accountDeleted}
        blockedHint={t("consent.deleteHint")}
      />
    </AuthLayout>
  );
}
