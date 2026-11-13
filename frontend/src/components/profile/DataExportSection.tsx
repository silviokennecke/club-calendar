import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, toast } from "@/components/ui/shared";
import { apiErrorCode, isStepUpCancelled } from "@/lib/api";
import { downloadBlob } from "@/lib/events/ics";
import { fetchDataExport } from "@/lib/profile/dataExport";
import { isRateLimited, retryAfterMinutes } from "@/lib/rateLimit";

/** "Download my data" panel: step-up confirmation, then the JSON file is saved through an object URL. */
export function DataExportSection() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  function failureText(error: unknown): string {
    if (isRateLimited(error)) {
      const minutes = retryAfterMinutes(error);
      return minutes
        ? t("profile.export.rateLimitedWait", { minutes })
        : t("profile.export.rateLimited");
    }
    const code = apiErrorCode(error);
    if (code === "step_up_required" || code === "step_up_unavailable")
      return t("profile.export.confirmAgain");
    if (code === "email_verification_required" || code === "consent_required")
      return t("profile.export.notAllowed");
    return t("profile.export.failed");
  }

  async function start() {
    if (busy) return;
    setFailure(undefined);
    setBusy(true);
    try {
      const { blob, filename } = await fetchDataExport();
      downloadBlob(blob, filename);
      toast.success(t("profile.export.done"));
    } catch (error) {
      if (!isStepUpCancelled(error)) setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ap-panel" aria-labelledby="pr-export">
      <div className="ap-stack">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="pr-export">
              {t("profile.export.title")}
            </h2>
            <p>{t("profile.export.text")}</p>
          </div>
          <Button variant="secondary" icon="download" loading={busy} onClick={() => void start()}>
            {busy ? t("profile.export.busy") : t("profile.export.action")}
          </Button>
        </div>
        <ul className="t-sm">
          <li>{t("profile.export.included")}</li>
          <li>{t("profile.export.excluded")}</li>
          <li>{t("profile.export.limit")}</li>
        </ul>
        {failure && <Banner tone="danger">{failure}</Banner>}
      </div>
    </section>
  );
}
