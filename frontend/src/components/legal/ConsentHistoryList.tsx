import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Modal, StatusBadge } from "@/components/ui/shared";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/dateFormat";
import { useConsentHistory, useLegalVersion, type ConsentRecord } from "@/lib/legal";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local date (in the user's date format) and time of an ISO instant. */
function dateTime(iso: string, dateFormat: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${formatDate(day, dateFormat)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ConsentVersionModal({
  record,
  onClose,
}: {
  record: ConsentRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useLegalVersion(record.documentId);
  return (
    <Modal
      size="wide"
      title={q.data?.title || record.documentTitle || t(`legal.${record.type}`)}
      closeLabel={t("profile.legal.close")}
      onClose={onClose}
      busy={q.isPending}
    >
      <LegalDocumentView document={q.data} loading={q.isPending} error={q.error} />
    </Modal>
  );
}

/**
 * The history of accepted legal document versions (loading, error, empty state, list with "View").
 * Used by the profile's legal section and the consent gate's history modal.
 */
export function ConsentHistoryList({
  enabled = true,
  onView,
}: {
  /** Request the history only when true (the profile loads it once its section was opened). */
  enabled?: boolean;
  onView: (record: ConsentRecord) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";
  const history = useConsentHistory(enabled);

  return (
    <>
      {history.isPending ? (
        <p className="t-sm t-muted" role="status">
          {t("profile.legal.loading")}
        </p>
      ) : history.isError ? (
        <div className="ap-stack ap-stack--sm">
          <p role="alert">{t("profile.legal.loadFailed")}</p>
          <div>
            <Button variant="secondary" icon="refresh" onClick={() => void history.refetch()}>
              {t("profile.legal.retry")}
            </Button>
          </div>
        </div>
      ) : history.data.length === 0 ? (
        <EmptyState
          icon="shield"
          headingLevel="h3"
          title={t("profile.legal.emptyTitle")}
          text={t("profile.legal.emptyText")}
        />
      ) : (
        <ul className="ap-stack ap-stack--sm" style={{ listStyle: "none", padding: 0 }}>
          {history.data.map((r) => {
            const version = formatDate(r.documentPublishedAt, dateFormat);
            return (
              <li
                key={r.id}
                className="ap-row"
                style={{
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div className="ap-stack ap-stack--sm" style={{ minWidth: 0 }}>
                  <p>
                    <strong>{t(`legal.${r.type}`)}</strong>{" "}
                    <span className="t-muted">{t("profile.legal.version", { date: version })}</span>{" "}
                    <StatusBadge
                      status={r.current ? "published" : "archived"}
                      label={t(
                        r.current ? "profile.legal.currentBadge" : "profile.legal.outdatedBadge",
                      )}
                    />
                  </p>
                  <p className="t-sm">
                    {t("profile.legal.consentedAt", {
                      date: dateTime(r.consentedAt, dateFormat),
                    })}
                  </p>
                  {(r.ipAddress || r.userAgent) && (
                    <p className="t-sm t-muted" style={{ overflowWrap: "anywhere" }}>
                      {[r.ipAddress, r.userAgent].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
                <Button
                  variant="secondary"
                  aria-label={t("profile.legal.viewLabel", {
                    type: t(`legal.${r.type}`),
                    date: version,
                  })}
                  onClick={() => onView(r)}
                >
                  {t("profile.legal.view")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * Modal with the consent history (consent gate). Opening a version replaces the list by the document;
 * closing it returns to the list.
 */
export function ConsentHistoryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<ConsentRecord | null>(null);
  if (viewing) return <ConsentVersionModal record={viewing} onClose={() => setViewing(null)} />;
  return (
    <Modal
      size="wide"
      title={t("profile.legal.history")}
      closeLabel={t("profile.legal.close")}
      onClose={onClose}
    >
      <ConsentHistoryList onView={setViewing} />
    </Modal>
  );
}
