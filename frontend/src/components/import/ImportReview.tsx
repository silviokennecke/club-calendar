import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import {
  IMPORT_MAX,
  MAX_INSTANCES_PER_RULE,
  applyIds,
  commonIds,
  commonStatus,
  groupItems,
  patchItems,
  replacedZones,
  selectionState,
  type IdField,
  type ImportCheck,
  type ImportItem,
  type RecurrenceStats,
} from "@/lib/import";
import type { Location } from "@/lib/types";
import { useIsMobile } from "@/lib/useMediaQuery";
import { Banner, Button } from "@/components/ui/shared";
import { AssignmentFields } from "@/components/events/AssignmentFields";
import { StatusSeg } from "@/components/events/StatusSeg";
import type { useEventResources } from "@/components/events/useEventResources";
import { ImportEditDialog, type EditTarget } from "./ImportEditDialog";
import { ReviewGroup } from "./ReviewGroup";

const NONE = new Set<string>();
const NO_ERRORS = new Map<string, string>();
const NO_WARNINGS = new Map<string, unknown[]>();

interface ImportReviewProps {
  items: ImportItem[];
  onItemsChange: Dispatch<SetStateAction<ImportItem[]>>;
  /** Events of the file that could not be read (no date or name). */
  skippedCount: number;
  /** What expanding the file's recurrences did (instances, unsupported rules, limits). */
  recurrence: RecurrenceStats;
  locations: Location[];
  resources: ReturnType<typeof useEventResources>;
  /** The backend's preview (or the browser's fallback check); null while it is pending. */
  check: ImportCheck | null;
  /** A (new) preview is running. */
  checking: boolean;
  /** The calendar's zone (named when unknown zones of the file are replaced). */
  timeZone: string | null;
  importing: boolean;
  /** The import cannot start yet (reference data still loading or failed). */
  blocked: boolean;
  onBack: () => void;
  onImport: () => void;
}

/**
 * Step 2 of the import (design: ImportReview, ImportReviewMobile): check what the file contains
 * before anything is created. Hints for skipped, repeating, possibly duplicate and rejected events
 * and replaced time zones (from the backend's preview), the limit per import, bulk settings for the
 * selection, the events in groups with tables, edit dialogs and the summary bar with the import button.
 */
export function ImportReview({
  items,
  onItemsChange,
  skippedCount,
  recurrence,
  locations,
  resources,
  check,
  checking,
  timeZone,
  importing,
  blocked,
  onBack,
  onImport,
}: ImportReviewProps) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const groups = useMemo(() => groupItems(items), [items]);
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.slice(0, 1).map((g) => g.key)),
  );
  const [editing, setEditing] = useState<EditTarget | null>(null);

  const selected = useMemo(() => items.filter((i) => i.selected), [items]);
  const duplicates = check?.duplicates ?? NONE;
  const invalid = check?.invalid ?? NO_ERRORS;
  const warned = check?.warningsOf ?? NO_WARNINGS;
  const selectedDuplicates = items.filter((i) => i.selected && duplicates.has(i.id)).length;
  const selectedInvalid = items.filter((i) => i.selected && invalid.has(i.id)).length;
  const zones = replacedZones(check?.warnings ?? []);
  const tooMany = selected.length > IMPORT_MAX;
  const recurring = items.filter((i) => i.recurring).length;
  const unsupported = items.filter((i) => i.recurrenceUnsupported).length;
  const fmt = (n: number) => n.toLocaleString(i18n.language);

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectAll = (on: boolean) =>
    onItemsChange((all) => patchItems(all, () => true, { selected: on }));

  /** Sets the ids of the selected items, adding / removing only what changed. */
  function bulkIds<K extends IdField>(field: K, next: string[]) {
    const previous = commonIds(selected, field);
    onItemsChange((all) => applyIds(all, (i) => i.selected, field, previous, next));
  }

  const bulkStatus = commonStatus(selected);
  const importLabel =
    selected.length === 0
      ? t("import.review.importLabelNone")
      : t("import.review.importLabel", { count: selected.length });

  const backButton = (
    <Button variant="secondary" onClick={onBack} disabled={importing}>
      {t("common.back")}
    </Button>
  );

  const bar = (
    <>
      <div>
        <p className="t-label" role="status">
          {t("import.review.selected", { selected: selected.length, total: items.length })}
        </p>
        {checking && <p className="t-sm t-muted">{t("import.review.checking")}</p>}
      </div>
      {/* Design: desktop "Zurück" before the import button, phones the import button on top
          (DOM order follows the visual order, so the focus order matches). */}
      <div className="ap-actions">
        {!isMobile && backButton}
        <Button
          disabled={selected.length === 0 || blocked || tooMany || selectedInvalid > 0}
          loading={importing}
          loadingLabel={t("import.review.importing")}
          onClick={onImport}
        >
          {importLabel}
        </Button>
        {isMobile && backButton}
      </div>
    </>
  );

  return (
    <div className="ap-stack ap-stack--lg">
      {skippedCount > 0 && (
        <Banner tone="danger" title={t("import.review.skipped.title", { count: skippedCount })}>
          {t("import.review.skipped.text", { count: skippedCount })}
        </Banner>
      )}
      {recurring > 0 && (
        <Banner tone="info" icon="repeat" title={t("import.review.recurrence.title")}>
          {t("import.review.recurrence.text", {
            count: recurring,
            rules: t("import.review.recurrence.rules", { count: recurrence.rules }),
          })}
        </Banner>
      )}
      {unsupported > 0 && (
        <Banner tone="warning" icon="repeat" title={t("import.review.recurrence.unsupported")}>
          {t("import.review.recurrence.unsupportedText", { count: unsupported })}
        </Banner>
      )}
      {(recurrence.capped > 0 || recurrence.unbounded > 0 || recurrence.dropped > 0) && (
        <Banner tone="warning" title={t("import.review.recurrence.limitTitle")}>
          <ul className="ap-stack" style={{ margin: 0, paddingLeft: "1.2em" }}>
            {recurrence.unbounded > 0 && (
              <li>
                {t("import.review.recurrence.unbounded", {
                  count: recurrence.unbounded,
                  max: fmt(MAX_INSTANCES_PER_RULE),
                })}
              </li>
            )}
            {recurrence.capped > 0 && (
              <li>
                {t("import.review.recurrence.capped", {
                  count: recurrence.capped,
                  max: fmt(MAX_INSTANCES_PER_RULE),
                })}
              </li>
            )}
            {recurrence.dropped > 0 && (
              <li>
                {t("import.review.recurrence.dropped", {
                  count: recurrence.dropped,
                  max: fmt(IMPORT_MAX),
                })}
              </li>
            )}
          </ul>
        </Banner>
      )}
      {tooMany && (
        <Banner tone="danger" title={t("import.review.tooMany.title")}>
          {t("import.review.tooMany.text", {
            max: IMPORT_MAX.toLocaleString(i18n.language),
            count: selected.length,
          })}
        </Banner>
      )}
      {invalid.size > 0 && (
        <Banner
          tone="danger"
          title={t("import.review.invalid.title", { count: invalid.size })}
          action={
            selectedInvalid > 0 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onItemsChange((all) =>
                    patchItems(all, (i) => invalid.has(i.id), { selected: false }),
                  )
                }
              >
                {t("import.review.invalid.deselect")}
              </Button>
            ) : undefined
          }
        >
          {t("import.review.invalid.text", { count: invalid.size })}
        </Banner>
      )}
      {zones.zones.length > 0 && (
        <Banner tone="warning" title={t("import.review.timezone.title")}>
          {t("import.review.timezone.text", {
            count: warned.size,
            zones: zones.zones.join(", "),
            zone: zones.replacement || timeZone || "UTC",
          })}
        </Banner>
      )}
      {duplicates.size > 0 && (
        <Banner
          tone="warning"
          title={t("import.review.duplicates.title", { count: duplicates.size })}
          action={
            selectedDuplicates > 0 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  onItemsChange((all) =>
                    patchItems(all, (i) => duplicates.has(i.id), { selected: false }),
                  )
                }
              >
                {t("import.review.duplicates.deselect")}
              </Button>
            ) : undefined
          }
        >
          {t("import.review.duplicates.text", { count: duplicates.size })}
        </Banner>
      )}

      <section className="ap-panel" aria-labelledby="bulk-h">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="bulk-h">
              {t("import.review.bulk.title")}
            </h2>
            <p className="t-sm t-muted">
              {selected.length > 0
                ? t("import.review.bulk.text", { count: selected.length })
                : t("import.review.bulk.none")}
            </p>
          </div>
        </div>
        <fieldset disabled={selected.length === 0} className="ap-stack m-0 min-w-0 border-0 p-0">
          <fieldset className="ap-fieldset">
            <legend>{t("events.form.status.label")}</legend>
            <StatusSeg
              value={bulkStatus}
              hintId="bulk-status-hint"
              draftLabel={t("import.review.bulk.draftDefault")}
              onChange={(status) =>
                onItemsChange((all) => patchItems(all, (i) => i.selected, { status }))
              }
            />
            <span className="cc-hint" id="bulk-status-hint">
              {bulkStatus === "published"
                ? t("import.review.bulk.publishedHint")
                : t("import.review.bulk.draftHint")}
            </span>
          </fieldset>
          <AssignmentFields
            resources={resources}
            value={{
              propertyIds: commonIds(selected, "propertyIds"),
              featureIds: commonIds(selected, "featureIds"),
              targetGroupIds: commonIds(selected, "targetGroupIds"),
            }}
            onChange={(field, ids) => bulkIds(field, ids)}
            targetGroupsHint={t("import.review.bulk.targetGroupsHint")}
          />
        </fieldset>
      </section>

      <section aria-labelledby="list-h" className="ap-stack">
        <div className="ap-row" style={{ justifyContent: "space-between" }}>
          <h2 className="t-h2" id="list-h">
            {t("import.review.list")}
          </h2>
          <div className="ap-actions">
            <Button
              variant="ghost"
              icon="check-square"
              disabled={selectionState(items) === "all"}
              onClick={() => selectAll(true)}
            >
              {t("import.review.selectAll")}
            </Button>
            <Button
              variant="ghost"
              icon="x"
              disabled={selected.length === 0}
              onClick={() => selectAll(false)}
            >
              {t("import.review.selectNone")}
            </Button>
          </div>
        </div>
        <ul className="ap-panel ap-panel--flush ap-reviewlist" aria-label={t("import.review.list")}>
          {groups.map((group) => (
            <ReviewGroup
              key={group.key}
              group={group}
              locations={locations}
              duplicates={duplicates}
              invalid={invalid}
              warned={warned}
              open={open.has(group.key)}
              onToggleOpen={() => toggleOpen(group.key)}
              onToggleGroup={() => {
                const on = selectionState(group.items) !== "all";
                const ids = new Set(group.items.map((i) => i.id));
                onItemsChange((all) => patchItems(all, (i) => ids.has(i.id), { selected: on }));
              }}
              onToggleItem={(id) =>
                onItemsChange((all) =>
                  all.map((i) => (i.id === id ? { ...i, selected: !i.selected } : i)),
                )
              }
              onEditGroup={() => setEditing({ kind: "group", group })}
              onEditItem={(id) => {
                const item = group.items.find((i) => i.id === id);
                if (item) setEditing({ kind: "item", item });
              }}
            />
          ))}
        </ul>
      </section>

      <div className="ap-reviewbar" role="group" aria-label={t("import.review.summaryLabel")}>
        <div className="ap-panel ap-reviewbar-panel">
          <div className="ap-row" style={{ justifyContent: "space-between" }}>
            {bar}
          </div>
        </div>
      </div>

      {editing && (
        <ImportEditDialog
          key={editing.kind === "item" ? editing.item.id : `g-${editing.group.key}`}
          target={editing}
          items={items}
          locations={locations}
          resources={resources}
          onClose={() => setEditing(null)}
          onSubmit={(update) => {
            onItemsChange(update);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
