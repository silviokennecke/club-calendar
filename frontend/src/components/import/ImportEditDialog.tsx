import { useState } from "react";
import { useTranslation } from "react-i18next";
import { validateEvent, type EventStatus } from "@/lib/events";
import {
  applyIds,
  commonIds,
  commonStatus,
  groupPlace,
  newPlaceNames,
  patchItems,
  placeFromValue,
  placeLabel,
  placeToValue,
  resolvePlace,
  type IdField,
  type ImportGroup,
  type ImportItem,
} from "@/lib/import";
import type { Location } from "@/lib/types";
import { locationName } from "@/lib/events";
import {
  Banner,
  Button,
  ErrorSummary,
  Field,
  FormDialog,
  NativeSelect,
  TextInput,
} from "@/components/ui/shared";
import { AssignmentFields, type Assignments } from "@/components/events/AssignmentFields";
import { StatusSeg } from "@/components/events/StatusSeg";
import type { useEventResources } from "@/components/events/useEventResources";

export type EditTarget = { kind: "item"; item: ImportItem } | { kind: "group"; group: ImportGroup };

interface ImportEditDialogProps {
  target: EditTarget;
  /** All items of the import (for the places offered "new from the file"). */
  items: ImportItem[];
  locations: Location[];
  resources: ReturnType<typeof useEventResources>;
  onClose: () => void;
  /** Applies the change to the items. */
  onSubmit: (update: (items: ImportItem[]) => ImportItem[]) => void;
}

const MIXED = "__mixed__";
const FIELD = {
  name: "imp-name",
  date: "imp-date",
  dateEnd: "imp-date-end",
  timeBegin: "imp-time-begin",
  timeEnd: "imp-time-end",
  note: "imp-note",
} as const;

interface DraftValues extends Assignments {
  name: string;
  date: string;
  dateEnd: string;
  isAllDay: boolean;
  timeBegin: string;
  timeEnd: string;
  status: EventStatus;
  /** `<select>` value of the place (see placeToValue; MIXED for differing group places). */
  place: string;
}

type DraftKey = keyof DraftValues;

/**
 * Edit one imported event or a whole group (design: ImportReview dialog). A group edit changes
 * only what the user touched, so the dates and other differences of its events stay as in the
 * file; tags are added / removed for all events instead of replaced.
 */
export function ImportEditDialog({
  target,
  items,
  locations,
  resources,
  onClose,
  onSubmit,
}: ImportEditDialogProps) {
  const { t } = useTranslation();
  const isGroup = target.kind === "group";
  const members = isGroup ? target.group.items : [target.item];
  const first = members[0];

  const initial: DraftValues = (() => {
    const place = isGroup ? groupPlace(members, locations) : resolvePlace(first, locations);
    return {
      name: isGroup ? (target.group.name ?? "") : first.name,
      date: first.date,
      dateEnd: first.dateEnd,
      isAllDay: members.every((m) => m.isAllDay),
      timeBegin: first.timeBegin,
      timeEnd: first.timeEnd,
      status: commonStatus(members) ?? "draft",
      place: place === "mixed" ? MIXED : placeToValue(place),
      propertyIds: commonIds(members, "propertyIds"),
      featureIds: commonIds(members, "featureIds"),
      targetGroupIds: commonIds(members, "targetGroupIds"),
    };
  })();

  const [values, setValues] = useState<DraftValues>(initial);
  const [touched, setTouched] = useState<Set<DraftKey>>(new Set());
  const [submits, setSubmits] = useState(0);

  function set<K extends DraftKey>(key: K, value: DraftValues[K]) {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((prev) => new Set(prev).add(key));
  }

  // A group has no date of its own; validate the rest with a placeholder day.
  const errors = validateEvent({
    ...values,
    date: isGroup ? "2000-01-01" : values.date,
    dateEnd: isGroup ? "" : values.dateEnd,
    status: values.status,
    locationId: "",
    eventTemplateId: null,
    note: "",
  });
  const summary = errors.map((e) => ({
    fieldId: FIELD[e.field],
    message: t(`events.form.errors.${e.code}`),
  }));
  const shown = submits > 0 ? errors : [];
  const errorFor = (field: keyof typeof FIELD) => {
    const err = shown.find((e) => e.field === field);
    return err ? t(`events.form.errors.${err.code}`) : undefined;
  };

  const newNames = newPlaceNames(items, locations);

  function apply() {
    setSubmits((n) => n + 1);
    if (errors.length > 0) return;
    const ids = new Set(members.map((m) => m.id));
    const mine = (item: ImportItem) => ids.has(item.id);
    const has = (key: DraftKey) => !isGroup || touched.has(key);

    onSubmit((all) => {
      const patch: Partial<ImportItem> = {};
      if (has("name")) patch.name = values.name.trim();
      if (!isGroup) {
        patch.date = values.date;
        patch.dateEnd = values.dateEnd;
      }
      if (has("isAllDay") || has("timeBegin") || has("timeEnd")) {
        patch.isAllDay = values.isAllDay;
        patch.timeBegin = values.isAllDay ? "00:00" : values.timeBegin;
        patch.timeEnd = values.isAllDay ? "23:59" : values.timeEnd;
      }
      if (has("status")) patch.status = values.status;
      if (has("place") && values.place !== MIXED)
        patch.placeOverride = placeFromValue(values.place);
      let next = patchItems(all, mine, patch);
      for (const field of ["propertyIds", "featureIds", "targetGroupIds"] as IdField[]) {
        next = applyIds(next, mine, field, initial[field], values[field]);
      }
      return next;
    });
  }

  const title = isGroup
    ? t("import.dialog.groupTitle", { name: target.group.name ?? t("import.review.othersName") })
    : t("import.dialog.itemTitle");

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      wide
      title={title}
      description={t("import.dialog.description")}
      onSubmit={apply}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit">{t("import.dialog.apply")}</Button>
        </>
      }
    >
      {isGroup && (
        <Banner tone="info" title={t("import.dialog.groupNoticeTitle")}>
          {t("import.dialog.groupNotice", { count: members.length })}
        </Banner>
      )}
      <ErrorSummary title={t("import.dialog.errorTitle")} errors={summary} focusSignal={submits} />
      <Field
        id={FIELD.name}
        label={isGroup ? t("import.dialog.groupName") : t("events.form.name")}
        required
        error={errorFor("name")}
      >
        <TextInput
          value={values.name}
          autoComplete="off"
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>
      {!isGroup && (
        <fieldset className="ap-fieldset">
          <legend className="ap-sr">{t("events.form.dates")}</legend>
          <div className="ap-inputrow">
            <Field id={FIELD.date} label={t("events.form.date")} required error={errorFor("date")}>
              <TextInput
                autoComplete="off"
                type="date"
                value={values.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field
              id={FIELD.dateEnd}
              label={t("events.form.dateEnd")}
              hint={t("events.form.dateEndHint")}
              error={errorFor("dateEnd")}
            >
              <TextInput
                autoComplete="off"
                type="date"
                value={values.dateEnd}
                min={values.date || undefined}
                onChange={(e) => set("dateEnd", e.target.value)}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <label className="ap-check">
        <input
          type="checkbox"
          checked={values.isAllDay}
          onChange={(e) => set("isAllDay", e.target.checked)}
        />
        <span>{t("events.form.allDay")}</span>
      </label>
      {!values.isAllDay && (
        <fieldset className="ap-fieldset">
          <legend className="ap-sr">{t("events.form.times")}</legend>
          <div className="ap-inputrow">
            <Field
              id={FIELD.timeBegin}
              label={t("events.form.timeBegin")}
              required
              error={errorFor("timeBegin")}
            >
              <TextInput
                autoComplete="off"
                type="time"
                value={values.timeBegin}
                onChange={(e) => set("timeBegin", e.target.value)}
              />
            </Field>
            <Field
              id={FIELD.timeEnd}
              label={t("events.form.timeEnd")}
              required
              error={errorFor("timeEnd")}
            >
              <TextInput
                autoComplete="off"
                type="time"
                value={values.timeEnd}
                onChange={(e) => set("timeEnd", e.target.value)}
              />
            </Field>
          </div>
        </fieldset>
      )}
      <fieldset className="ap-fieldset">
        <legend>{t("events.form.status.label")}</legend>
        <StatusSeg value={values.status} onChange={(s) => set("status", s)} />
      </fieldset>
      <Field id="imp-place" label={t("import.dialog.place")} optional>
        <NativeSelect value={values.place} onChange={(e) => set("place", e.target.value)}>
          {values.place === MIXED && (
            <option value={MIXED} disabled>
              {t("import.dialog.placeMixed")}
            </option>
          )}
          <option value="">{t("import.dialog.noPlace")}</option>
          {locations.map((l) => (
            <option key={l.id} value={`id:${l.id}`}>
              {locationName(l)}
            </option>
          ))}
          {newNames.map((name) => (
            <option key={name} value={placeToValue({ kind: "new", name })}>
              {t("import.dialog.placeNew", {
                name: placeLabel({ kind: "new", name }, locations),
              })}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <AssignmentFields
        resources={resources}
        value={values}
        onChange={(field, ids) => set(field, ids)}
      />
    </FormDialog>
  );
}
