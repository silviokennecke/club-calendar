import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import type { EventTemplate, Property, Feature, TargetGroup, Location } from "@/lib/types";
import { formatLocationLabel } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

interface Props {
  calendarId: string;
  open: boolean;
  onClose: () => void;
  template?: EventTemplate | null;
}

export default function TemplateModal({ calendarId, open, onClose, template }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEditing = !!template;

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [timeBegin, setTimeBegin] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("21:00");
  const [locationId, setLocationId] = useState<string>("");
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: properties = [] } = useQuery({
    queryKey: ["properties", calendarId],
    queryFn: () => apiGet<Property[]>(`/api/calendars/${calendarId}/properties`),
    enabled: open,
  });
  const { data: features = [] } = useQuery({
    queryKey: ["features", calendarId],
    queryFn: () => apiGet<Feature[]>(`/api/calendars/${calendarId}/features`),
    enabled: open,
  });
  const { data: targetGroups = [] } = useQuery({
    queryKey: ["targetGroups", calendarId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/calendars/${calendarId}/target-groups`),
    enabled: open,
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["locations", calendarId],
    queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`),
    enabled: open,
  });

  useEffect(() => {
    if (template) {
      setName(template.name);
      setTimezone(template.timezone);
      setTimeBegin(template.timeBegin);
      setTimeEnd(template.timeEnd);
      setLocationId(template.locationId ?? "");
      setSelectedPropertyIds(template.properties.map((p) => p.property.id));
      setSelectedFeatureIds(template.features.map((f) => f.feature.id));
      setSelectedTargetGroupIds(template.targetGroups.map((t) => t.targetGroup.id));
    } else {
      setName("");
      setTimezone("Europe/Berlin");
      setTimeBegin("19:00");
      setTimeEnd("21:00");
      setLocationId("");
      setSelectedPropertyIds([]);
      setSelectedFeatureIds([]);
      setSelectedTargetGroupIds([]);
    }
  }, [template, open]);

  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = {
        name,
        timezone,
        timeBegin,
        timeEnd,
        locationId: locationId === "" ? null : locationId,
        propertyIds: selectedPropertyIds,
        featureIds: selectedFeatureIds,
        targetGroupIds: selectedTargetGroupIds,
      };
      if (isEditing) {
        await apiPatch(`/api/calendars/${calendarId}/templates/${template!.id}`, body);
      } else {
        await apiPost(`/api/calendars/${calendarId}/templates`, body);
      }
      qc.invalidateQueries({ queryKey: ["templates", calendarId] });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t("templates.editTemplate") : t("templates.newTemplate")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1">
            <Label htmlFor="tpl-name">{t("eventModal.eventName")}</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-1 space-y-1">
              <Label htmlFor="tpl-tz">{t("templates.timezone")}</Label>
              <Input
                id="tpl-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Europe/Berlin"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-begin">{t("templates.startTime")}</Label>
              <Input
                id="tpl-begin"
                type="time"
                value={timeBegin}
                onChange={(e) => setTimeBegin(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-end">{t("templates.endTime")}</Label>
              <Input
                id="tpl-end"
                type="time"
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
              />
            </div>
          </div>

          {locations.length > 0 && (
            <div className="space-y-1">
              <Label>{t("templates.defaultLocation")}</Label>
              <select
                className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">{t("templates.noDefaultLocation")}</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {formatLocationLabel(l)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {properties.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("eventModal.properties")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPropertyIds(toggle(selectedPropertyIds, p.id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedPropertyIds.includes(p.id) ? "border-blue-300 bg-blue-100 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  >
                    {p.icon && <span className="mr-1">{p.icon}</span>}
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {features.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("eventModal.features")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {features.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedFeatureIds(toggle(selectedFeatureIds, f.id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedFeatureIds.includes(f.id) ? "border-green-300 bg-green-100 text-green-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {targetGroups.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("eventModal.targetGroups")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {targetGroups.map((tg) => (
                  <button
                    key={tg.id}
                    type="button"
                    onClick={() => setSelectedTargetGroupIds(toggle(selectedTargetGroupIds, tg.id))}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedTargetGroupIds.includes(tg.id) ? "border-purple-300 bg-purple-100 text-purple-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                  >
                    {tg.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving || !name.trim()} onClick={handleSave}>
            {saving
              ? t("templates.saving")
              : isEditing
                ? t("templates.saveChanges")
                : t("templates.createTemplate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
