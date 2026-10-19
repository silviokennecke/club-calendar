import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, Modal, StatusBadge } from "@/components/ui/shared";
import { LegalDocumentView } from "@/components/legal/LegalDocumentView";
import { LegalLinks } from "@/components/legal/LegalLinks";
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

function VersionModal({ record, onClose }: { record: ConsentRecord; onClose: () => void }) {
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
 * "Legal & consents" panel: current documents and the history of accepted versions. A collapsed native
 * `<details>`; the history is requested only once the section was opened.
 */
export function LegalSection() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dateFormat = user?.dateFormat ?? "dd.MM.yyyy";
  const [opened, setOpened] = useState(false);
  const [viewing, setViewing] = useState<ConsentRecord | null>(null);
  const history = useConsentHistory(opened);

  return (
    <section className="ap-panel" aria-labelledby="pr-legal">
      <details
        className="ap-details"
        onToggle={(e) => {
          if (e.currentTarget.open) setOpened(true);
        }}
      >
        <summary>
          <span className="t-h2" id="pr-legal">
            {t("profile.legal.title")}
          </span>
        </summary>
        <div className="ap-stack" style={{ marginTop: 12 }}>
          <p>{t("profile.legal.text")}</p>
          <h3 className="t-h3">{t("profile.legal.current")}</h3>
          <LegalLinks />
          <h3 className="t-h3">{t("profile.legal.history")}</h3>
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
                        <span className="t-muted">
                          {t("profile.legal.version", { date: version })}
                        </span>{" "}
                        <StatusBadge
                          status={r.current ? "published" : "archived"}
                          label={t(
                            r.current
                              ? "profile.legal.currentBadge"
                              : "profile.legal.outdatedBadge",
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
                      onClick={() => setViewing(r)}
                    >
                      {t("profile.legal.view")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>
      {viewing && <VersionModal record={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
