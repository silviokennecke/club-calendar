import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ChipSelect, toast } from "@/components/ui/shared";
import type { useEventResources } from "./useEventResources";

export interface Assignments {
  propertyIds: string[];
  featureIds: string[];
  targetGroupIds: string[];
}

interface AssignmentFieldsProps {
  resources: ReturnType<typeof useEventResources>;
  value: Assignments;
  onChange: <K extends keyof Assignments>(field: K, ids: Assignments[K]) => void;
  /** No inline creation of new entries. */
  readOnly?: boolean;
  /** Help text below the target groups (default: "Ohne Auswahl gilt der Termin für alle."). */
  targetGroupsHint?: ReactNode;
}

/**
 * Properties, features and target groups as chip selects with inline creation. Shared by the
 * event form, the template form and the import review.
 */
export function AssignmentFields({
  resources: res,
  value,
  onChange,
  readOnly,
  targetGroupsHint,
}: AssignmentFieldsProps) {
  const { t } = useTranslation();

  /** Creates an entry; a failure is reported here and rethrown so the chip row stays open. */
  async function create(fn: (name: string) => Promise<{ id: string }>, name: string) {
    try {
      return (await fn(name)).id;
    } catch (err) {
      toast.error(t("events.form.createFailed"));
      throw err;
    }
  }

  return (
    <>
      <ChipSelect
        label={t("events.form.properties")}
        options={res.properties.map((p) => ({
          id: p.id,
          label: p.icon ? `${p.icon} ${p.name}` : p.name,
        }))}
        selected={value.propertyIds}
        onChange={(ids) => onChange("propertyIds", ids)}
        onCreate={readOnly ? undefined : (name) => create(res.createProperty, name)}
        createLabel={t("events.form.createProperty")}
      />
      <ChipSelect
        label={t("events.form.features")}
        options={res.features.map((f) => ({ id: f.id, label: f.name }))}
        selected={value.featureIds}
        onChange={(ids) => onChange("featureIds", ids)}
        onCreate={readOnly ? undefined : (name) => create(res.createFeature, name)}
        createLabel={t("events.form.createFeature")}
      />
      <ChipSelect
        label={t("events.form.targetGroups")}
        options={res.targetGroups.map((g) => ({ id: g.id, label: g.name }))}
        selected={value.targetGroupIds}
        onChange={(ids) => onChange("targetGroupIds", ids)}
        onCreate={readOnly ? undefined : (name) => create(res.createTargetGroup, name)}
        createLabel={t("events.form.createTargetGroup")}
        hint={targetGroupsHint ?? t("events.form.targetGroupsHint")}
      />
    </>
  );
}
