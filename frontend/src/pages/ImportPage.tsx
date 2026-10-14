import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, apiPost } from "@/lib/api";
import {
  IMPORT_MAX,
  buildItems,
  findDuplicates,
  groupItems,
  summarizeImport,
  toImportRequest,
  type ImportCheck,
  type ImportItem,
} from "@/lib/import";
import type { ImportResponse } from "@/lib/types";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { Banner, Button, Stepper, UnsavedChangesDialog } from "@/components/ui/shared";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";
import { useAllEvents, useEventPage } from "@/components/events/useEventPage";
import { useEventResources } from "@/components/events/useEventResources";
import { ImportDone, type ImportResult } from "@/components/import/ImportDone";
import { ImportReview } from "@/components/import/ImportReview";
import { ImportUpload, type ParsedFile } from "@/components/import/ImportUpload";
import { useImportPreview } from "@/components/import/useImportPreview";

type Step = "upload" | "review" | "done";

/**
 * ICS import in three steps (design: Import, ImportReview, ImportDone) with a Stepper. The file is
 * parsed in the browser; the backend's preview (`POST …/events/import/preview`) reports duplicates,
 * entries it would reject and replaced time zones, and the reviewed events (with new places) are
 * imported in ONE atomic request (`POST …/events/import`: all or nothing).
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

  const navigate = useNavigate();
  const location = useLocation();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const itemsOf = useRef<ParsedFile | null>(null);

  // The step lives in the history entry's state (`{ importStep }`), so the browser's back / forward
  // buttons move between the steps. A step whose data is gone (reload, forward into a step after the
  // state was dropped) shows the file step instead.
  const wanted = (location.state as { importStep?: Step } | null)?.importStep;
  const step: Step =
    wanted === "review" && file ? "review" : wanted === "done" && result ? "done" : "upload";
  const goTo = (to: Step | null, replace: boolean) =>
    navigate(location.pathname + location.search, {
      replace,
      state: to ? { importStep: to } : null,
    });

  const unsaved = useUnsavedChanges(step === "review" && !importing, { blockSamePath: true });
  const groups = useMemo(() => groupItems(items), [items]);

  // Duplicates, rejected entries and warnings come from the backend's preview; only if it fails, the
  // browser compares name + day with the calendar's events (loaded only then).
  const preview = useImportPreview(
    page.calendarId,
    items,
    resources.locations,
    step === "review" && !resources.loading && !resources.failed,
  );
  const existing = useAllEvents(page.calendarId, { enabled: preview.status === "failed" });
  const check = useMemo<ImportCheck | null>(() => {
    if (preview.check) return preview.check;
    if (preview.status !== "failed" || !existing.data) return null;
    return {
      duplicates: findDuplicates(items, existing.data),
      invalid: new Map(),
      warnings: [],
      warningsOf: new Map(),
    };
  }, [preview, existing.data, items]);

  // The import may still run when the user leaves the page; its end must not navigate back here.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (step !== "done") heading.current?.focus({ preventScroll: true });
  }, [step]);

  // A history entry that names a step whose data is gone (reload on the review, forward into the
  // result after leaving it) is cleaned up, so going back later cannot land on a stale step again.
  useEffect(() => {
    if (wanted && wanted !== step)
      navigate(location.pathname + location.search, { replace: true, state: null });
  }, [wanted, step, navigate, location.pathname, location.search]);

  // Back from the result to the file step must not offer the finished import again: drop it all.
  useEffect(() => {
    if (step === "upload" && result) {
      setFile(null);
      setItems([]);
      itemsOf.current = null;
      setResult(null);
    }
  }, [step, result]);

  function onParsed(parsed: ParsedFile) {
    setFile(parsed);
    // Coming back with the same file keeps the edits made in the review.
    if (itemsOf.current !== parsed) {
      itemsOf.current = parsed;
      setItems(buildItems(parsed.events));
    }
    goTo("review", false);
  }

  /** "Zurück" of the review = the browser's back button (one history entry per step). */
  function back() {
    unsaved.allow();
    navigate(-1);
  }

  function reset() {
    setFile(null);
    setItems([]);
    itemsOf.current = null;
    setResult(null);
    goTo(null, true);
  }

  async function runImport() {
    if (!file || importing) return;
    const chosen = items.filter((i) => i.selected);
    if (chosen.length === 0 || chosen.length > IMPORT_MAX) return;
    const summary = summarizeImport(items, resources.locations);
    const request = toImportRequest(chosen, resources.locations);
    setImporting(true);
    try {
      // One request, one transaction: new places and events are created together or not at all.
      const res = await apiPost<ImportResponse>(`/api/calendars/${page.calendarId}/events/import`, {
        ...request,
        skipDuplicates: false,
      });
      const placeNames = new Map(request.locations.map((l) => [l.tempId, l.name]));
      setResult({
        kind: "ok",
        imported: res.imported,
        skipped: res.skipped,
        drafts: summary.drafts,
        published: summary.published,
        newPlaces: res.createdLocations.map((l) => placeNames.get(l.tempId) ?? l.tempId),
        unselected: summary.unselected,
        invalid: file.skipped.length,
        warnings: res.warnings,
      });
    } catch (e) {
      setResult({
        kind: "error",
        reason: e instanceof ApiError && e.code === "too_many_events" ? "tooMany" : "failed",
      });
    } finally {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["events", page.calendarId] }),
        qc.invalidateQueries({ queryKey: ["locations", page.calendarId] }),
      ]);
      setImporting(false);
      // Replaces the review entry: back from the result leads to the file step, never to the review.
      if (mounted.current) goTo("done", true);
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
              initial={result ? null : file}
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
            {file.encoding === "windows-1252" && (
              <Banner tone="warning" title={t("import.review.encoding.title")}>
                {t("import.review.encoding.text")}
              </Banner>
            )}
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
              recurrence={file.recurrence}
              locations={resources.locations}
              resources={resources}
              check={check}
              checking={
                preview.status === "loading" || (preview.status === "ready" && preview.stale)
              }
              timeZone={page.timeZone}
              importing={importing}
              blocked={resources.loading || resources.failed}
              onBack={back}
              onImport={runImport}
            />
          </>
        )}

        {step === "done" && result && (
          <ImportDone
            result={result}
            calendarUrl={page.base}
            eventsUrl={page.routes.list}
            timeZone={page.timeZone}
            onRetry={() => goTo("review", true)}
            onAnother={reset}
          />
        )}
      </div>
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );
}
