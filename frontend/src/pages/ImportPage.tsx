import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiPost } from "@/lib/api";
import {
  IMPORT_CHUNK,
  buildItems,
  chunk,
  groupItems,
  newPlaceKey,
  summarizeImport,
  toImportPayload,
  type ImportItem,
} from "@/lib/import";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { Banner, Button, Stepper, UnsavedChangesDialog } from "@/components/ui/shared";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";
import { useAllEvents, useEventPage } from "@/components/events/useEventPage";
import { useEventResources } from "@/components/events/useEventResources";
import { ImportDone, type ImportResult } from "@/components/import/ImportDone";
import { ImportReview } from "@/components/import/ImportReview";
import { ImportUpload, type ParsedFile } from "@/components/import/ImportUpload";

type Step = "upload" | "review" | "done";

/**
 * ICS import in three steps (design: Import, ImportReview, ImportDone) with a Stepper. The backend
 * only offers `POST …/events/import`, no dry run, so the file is parsed and checked in the browser
 * and only the reviewed events are sent (docs/redesign/BACKEND-GAPS.md).
 */
export default function ImportPage() {
  return (
    <ArchivedCreateGuard>
      <Import />
    </ArchivedCreateGuard>
  );
}

function Import() {
  const { t } = useTranslation();
  const page = useEventPage();
  const qc = useQueryClient();
  const resources = useEventResources(page.calendarId);
  const existing = useAllEvents(page.calendarId);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const itemsOf = useRef<ParsedFile | null>(null);

  const unsaved = useUnsavedChanges(step === "review" && !importing);
  const groups = useMemo(() => groupItems(items), [items]);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step !== "done") heading.current?.focus({ preventScroll: true });
  }, [step]);

  function onParsed(parsed: ParsedFile) {
    setFile(parsed);
    // Coming back with the same file keeps the edits made in the review.
    if (itemsOf.current !== parsed) {
      itemsOf.current = parsed;
      setItems(buildItems(parsed.events));
    }
    setStep("review");
  }

  function reset() {
    setFile(null);
    setItems([]);
    itemsOf.current = null;
    setResult(null);
    setStep("upload");
  }

  async function runImport() {
    if (!file || importing) return;
    const chosen = items.filter((i) => i.selected);
    if (chosen.length === 0) return;
    const summary = summarizeImport(items, resources.locations);
    setImporting(true);
    let imported = 0;
    try {
      const newPlaceIds = new Map<string, string>();
      for (const name of summary.newPlaces) {
        const created = await resources.createLocation(name);
        newPlaceIds.set(newPlaceKey(name), created.id);
      }
      const payloads = chosen.map((i) => toImportPayload(i, resources.locations, newPlaceIds));
      for (const events of chunk(payloads, IMPORT_CHUNK)) {
        const res = await apiPost<{ imported: number }>(
          `/api/calendars/${page.calendarId}/events/import`,
          { events },
        );
        imported += res.imported;
      }
      setResult({
        kind: "ok",
        imported,
        drafts: summary.drafts,
        published: summary.published,
        newPlaces: summary.newPlaces,
        unselected: summary.unselected,
        invalid: file.skipped.length,
      });
    } catch {
      setResult({
        kind: "error",
        imported,
        notImported: items
          .filter((i) => i.selected)
          .slice(imported)
          .map((i) => ({ name: i.name, date: i.date, dateEnd: i.dateEnd })),
      });
    } finally {
      await qc.invalidateQueries({ queryKey: ["events", page.calendarId] });
      setImporting(false);
      setStep("done");
    }
  }

  const steps = [t("import.steps.file"), t("import.steps.review"), t("import.steps.done")];
  const stepNo = step === "upload" ? 1 : step === "review" ? 2 : 3;

  return (
    <div className={step === "review" ? "ap-wrap" : "ap-wrap--narrow"}>
      <div className="ap-stack ap-stack--lg">
        <Stepper steps={steps} current={stepNo} />

        {step === "upload" && (
          <>
            <header className="ap-stack">
              <h1 className="t-h1 ap-focus-target" ref={heading} tabIndex={-1}>
                {t("import.title")}
              </h1>
              <p className="t-body t-prose">{t("import.upload.intro")}</p>
              <Banner tone="info" title={t("import.upload.series.title")}>
                {t("import.upload.series.text")}
              </Banner>
            </header>
            <ImportUpload
              cancelTo={page.base}
              timeZone={page.timeZone}
              initial={file}
              onParsed={onParsed}
            />
          </>
        )}

        {step === "review" && file && (
          <>
            <header>
              <h1 className="t-h1 ap-focus-target" ref={heading} tabIndex={-1}>
                {t("import.review.title", { file: file.fileName, count: items.length })}
              </h1>
              <p className="t-body t-muted" style={{ marginTop: "var(--space-2)" }}>
                {t("import.review.subtitle", { count: groups.length })}
              </p>
            </header>
            {resources.failed && (
              <Banner
                tone="danger"
                title={t("import.review.loadError.title")}
                action={
                  <Button variant="secondary" icon="refresh" onClick={resources.reload}>
                    {t("import.review.loadError.retry")}
                  </Button>
                }
              >
                {t("import.review.loadError.text")}
              </Banner>
            )}
            <ImportReview
              items={items}
              onItemsChange={setItems}
              skippedCount={file.skipped.length}
              locations={resources.locations}
              resources={resources}
              existing={existing.data ?? []}
              importing={importing}
              blocked={resources.loading || resources.failed}
              onBack={() => setStep("upload")}
              onImport={runImport}
            />
          </>
        )}

        {step === "done" && result && (
          <ImportDone
            result={result}
            calendarUrl={page.base}
            eventsUrl={page.routes.list}
            onRetry={() => setStep("review")}
            onAnother={reset}
          />
        )}
      </div>
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );
}
