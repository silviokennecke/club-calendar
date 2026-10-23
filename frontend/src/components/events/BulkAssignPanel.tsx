import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, SearchInput } from "@/components/ui/shared";
import type { Feature, Property, TargetGroup } from "@/lib/types";

export interface BulkAssignment {
  targetGroupIds: string[];
  featureIds: string[];
  propertyIds: string[];
}

interface Props {
  targetGroups: TargetGroup[];
  features: Feature[];
  properties: Property[];
  busy: boolean;
  onApply: (assignment: BulkAssignment) => void;
}

type Option = { id: string; name: string };

/** Searchable multi-select with sections; adds the chosen target groups, features and properties to the selected events. */
export function BulkAssignPanel({ targetGroups, features, properties, busy, onApply }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<keyof BulkAssignment, Set<string>>>({
    targetGroupIds: new Set(),
    featureIds: new Set(),
    propertyIds: new Set(),
  });
  const q = search.trim().toLowerCase();
  const count = picked.targetGroupIds.size + picked.featureIds.size + picked.propertyIds.size;

  function toggle(key: keyof BulkAssignment, id: string) {
    setPicked((prev) => {
      const next = new Set(prev[key]);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, [key]: next };
    });
  }

  const sections: { key: keyof BulkAssignment; title: string; options: Option[] }[] = [
    {
      key: "targetGroupIds",
      title: t("events.list.bulk.assign.targetGroups"),
      options: targetGroups,
    },
    { key: "propertyIds", title: t("events.list.bulk.assign.properties"), options: properties },
    { key: "featureIds", title: t("events.list.bulk.assign.features"), options: features },
  ];
  const visible = sections.map((s) => ({
    ...s,
    options: s.options.filter((o) => !q || o.name.toLowerCase().includes(q)),
  }));
  const any = visible.some((s) => s.options.length > 0);

  return (
    <div className="ap-bulkassign">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder={t("events.list.bulk.assign.search")}
      />
      <div className="ap-bulkassign-sections">
        {visible.map(
          (s) =>
            s.options.length > 0 && (
              <fieldset key={s.key} className="ap-bulkassign-section">
                <legend className="t-label">{s.title}</legend>
                {s.options.map((o) => (
                  <label key={o.id} className="ap-bulkassign-option">
                    <input
                      type="checkbox"
                      checked={picked[s.key].has(o.id)}
                      onChange={() => toggle(s.key, o.id)}
                    />
                    <span>{o.name}</span>
                  </label>
                ))}
              </fieldset>
            ),
        )}
        {!any && <p className="t-sm t-muted">{t("events.list.bulk.assign.none")}</p>}
      </div>
      <p className="t-sm t-muted">{t("events.list.bulk.assign.hint")}</p>
      <Button
        disabled={busy || count === 0}
        onClick={() =>
          onApply({
            targetGroupIds: [...picked.targetGroupIds],
            featureIds: [...picked.featureIds],
            propertyIds: [...picked.propertyIds],
          })
        }
      >
        {t("events.list.bulk.assign.apply", { count })}
      </Button>
    </div>
  );
}
