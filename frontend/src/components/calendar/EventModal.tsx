import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete, getHolidayEvents } from "@/lib/api";
import type {
  CalendarEvent,
  Property,
  Feature,
  TargetGroup,
  Location,
  EventTemplate,
  HolidayEvent,
} from "@/lib/types";
import { formatAddress, formatLocationLabel } from "@/lib/types";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Banner,
  Button as DsButton,
  ConfirmDialog,
  IconButton,
  toast,
} from "@/components/ui/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, X } from "lucide-react";
const MapPicker = lazy(() => import("@/components/locations/MapPicker"));

export function filterDatesExcludingHolidays(dates: string[], holidays: HolidayEvent[]): string[] {
  return dates.filter(
    (date) =>
      !holidays.some((h) => {
        const end = h.dateEnd ?? h.date;
        return date >= h.date && date <= end;
      }),
  );
}

// ——— Recurrence helpers ———

type RecurrenceMode = "weekly" | "biweekly" | "nth-weekday";

function generateDates(mode: RecurrenceMode, config: RecurrenceConfig): string[] {
  const dates: string[] = [];
  if (!config.from || !config.to) return dates;
  const from = new Date(config.from);
  const to = new Date(config.to);
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to) return dates;

  if (mode === "weekly" || mode === "biweekly") {
    const step = mode === "biweekly" ? 14 : 7;
    const weekday = config.weekday ?? 1;
    // Find first occurrence of weekday >= from
    const d = new Date(from);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    while (d <= to) {
      dates.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + step);
    }
  } else if (mode === "nth-weekday") {
    // Every Nth weekday of each month
    const weekday = config.weekday ?? 1;
    const nth = config.nth ?? 0; // 0=1st, 1=2nd, 2=3rd, 3=4th, 4=last
    const month = new Date(from.getFullYear(), from.getMonth(), 1);
    while (month <= to) {
      const occurrences: Date[] = [];
      const cur = new Date(month);
      while (cur.getMonth() === month.getMonth()) {
        if (cur.getDay() === weekday) occurrences.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      const idx = nth === 4 ? occurrences.length - 1 : nth;
      const pick = occurrences[idx];
      if (pick && pick >= from && pick <= to) {
        dates.push(pick.toISOString().slice(0, 10));
      }
      month.setMonth(month.getMonth() + 1);
    }
  }
  return dates;
}

interface RecurrenceConfig {
  from: string;
  to: string;
  weekday: number;
  nth: number;
}

// ——— Inline creator ———
function InlineCreate({
  label,
  placeholder,
  onAdd,
}: {
  label: string;
  placeholder: string;
  onAdd: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdd() {
    if (!value.trim()) return;
    setLoading(true);
    try {
      await onAdd(value.trim());
      setValue("");
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 flex items-center gap-0.5 text-xs text-blue-600 hover:text-blue-800"
      >
        <Plus className="h-3 w-3" />
        {t("common.add")} {label}
      </button>
    );
  return (
    <div className="mt-1 flex items-center gap-1">
      <Input
        className="h-7 flex-1 text-xs"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        autoFocus
      />
      <Button size="sm" className="h-7 px-2 text-xs" disabled={loading} onClick={handleAdd}>
        {t("common.add")}
      </Button>
      <button
        onClick={() => {
          setOpen(false);
          setValue("");
        }}
        className="text-slate-400 hover:text-slate-600"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ——— Main modal ———
interface Props {
  calendarId: string;
  open: boolean;
  onClose: () => void;
  defaultDate?: string;
  event?: CalendarEvent | null;
  /** Archived calendar: show the event without editing, saving or deleting. */
  readOnly?: boolean;
  /** Tab when creating ("Aus Vorlage" opens the template tab). */
  initialTab?: "manual" | "template";
}

/**
 * View / edit / delete an event and create events (manually or as a series from a template).
 * Dialog frame, actions and confirmation use the design system; the form itself is redesigned
 * in phase 4 (EventForm).
 */
export default function EventModal({
  calendarId,
  open,
  onClose,
  defaultDate,
  event,
  readOnly = false,
  initialTab = "manual",
}: Props) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const WEEKDAYS = t("eventModal.weekdays", { returnObjects: true }) as string[];
  const NTH_LABELS = t("eventModal.nthLabels", { returnObjects: true }) as string[];
  const isEditing = !!event;

  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [timeBegin, setTimeBegin] = useState("19:00");
  const [timeEnd, setTimeEnd] = useState("21:00");
  const [isDraft, setIsDraft] = useState(true);
  const [isAllDay, setIsAllDay] = useState(false);
  const [locationId, setLocationId] = useState<string>("");
  const [showMap, setShowMap] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [selectedFeatureIds, setSelectedFeatureIds] = useState<string[]>([]);
  const [selectedTargetGroupIds, setSelectedTargetGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tab, setTab] = useState<"manual" | "template">("manual");

  // Series state
  const [templateId, setTemplateId] = useState<string>("");
  const [recMode, setRecMode] = useState<RecurrenceMode>("weekly");
  const [recConfig, setRecConfig] = useState<RecurrenceConfig>({
    from: "",
    to: "",
    weekday: 1,
    nth: 0,
  });
  const generatedDates = generateDates(recMode, recConfig);

  const [excludeHolidays, setExcludeHolidays] = useState(false);
  const [holidays, setHolidays] = useState<HolidayEvent[]>([]);
  const [loadingHolidays, setLoadingHolidays] = useState(false);

  useEffect(() => {
    if (!excludeHolidays || !recConfig.from || !recConfig.to) {
      setHolidays([]);
      return;
    }
    let cancelled = false;
    setLoadingHolidays(true);
    getHolidayEvents(calendarId, recConfig.from, recConfig.to)
      .then((data) => {
        if (!cancelled) setHolidays(data);
      })
      .catch(() => {
        if (!cancelled) setHolidays([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingHolidays(false);
      });
    return () => {
      cancelled = true;
    };
  }, [excludeHolidays, recConfig.from, recConfig.to, calendarId]);

  const effectiveDates = excludeHolidays
    ? filterDatesExcludingHolidays(generatedDates, holidays)
    : generatedDates;

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
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", calendarId],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`),
    enabled: open && tab === "template",
  });

  const selectedLocation = locations.find((l) => l.id === locationId);

  useEffect(() => {
    if (event) {
      setName(event.name);
      setDate(event.date.slice(0, 10));
      setTimeBegin(event.timeBegin);
      setTimeEnd(event.timeEnd);
      setIsDraft(event.isDraft);
      setIsAllDay(event.isAllDay ?? false);
      setDateEnd(event.dateEnd?.slice(0, 10) ?? "");
      setLocationId(event.locationId ?? "");
      setSelectedPropertyIds(event.properties.map((p) => p.property.id));
      setSelectedFeatureIds(event.features.map((f) => f.feature.id));
      setSelectedTargetGroupIds(event.targetGroups.map((t) => t.targetGroup.id));
      setShowMap(false);
    } else {
      setName("");
      setDate(defaultDate ?? "");
      setTimeBegin("19:00");
      setTimeEnd("21:00");
      setIsDraft(true);
      setIsAllDay(false);
      setDateEnd("");
      setLocationId("");
      setShowMap(false);
      setSelectedPropertyIds([]);
      setSelectedFeatureIds([]);
      setSelectedTargetGroupIds([]);
    }
    setTab(initialTab);
  }, [event, defaultDate, open, initialTab]);

  function toggle<T>(arr: T[], val: T): T[] {
    return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const body = {
        name,
        date,
        timeBegin,
        timeEnd,
        isDraft,
        isAllDay,
        dateEnd: dateEnd || null,
        locationId: locationId === "" ? null : locationId,
        propertyIds: selectedPropertyIds,
        featureIds: selectedFeatureIds,
        targetGroupIds: selectedTargetGroupIds,
      };
      if (isEditing) await apiPatch(`/api/calendars/${calendarId}/events/${event!.id}`, body);
      else await apiPost(`/api/calendars/${calendarId}/events`, body);
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
      toast.success(t("eventModal.saved"));
      onClose();
    } catch {
      toast.error(t("eventModal.saveFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateSeries() {
    if (!templateId || effectiveDates.length === 0) return;
    setLoading(true);
    try {
      await apiPost(`/api/calendars/${calendarId}/events/from-template`, {
        templateId,
        dates: effectiveDates,
        overrides: { isDraft },
      });
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
      toast.success(t("eventModal.saved"));
      onClose();
    } catch {
      toast.error(t("eventModal.saveFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setLoading(true);
    try {
      await apiDelete(`/api/calendars/${calendarId}/events/${event!.id}`);
      qc.invalidateQueries({ queryKey: ["events", calendarId] });
      toast.success(t("eventModal.deleted"));
      setDeleteDialogOpen(false);
      onClose();
    } catch {
      toast.error(t("eventModal.deleteFailed"));
    } finally {
      setLoading(false);
    }
  }

  // Inline creators
  async function addProperty(name: string) {
    const created = await apiPost<Property>(`/api/calendars/${calendarId}/properties`, { name });
    qc.invalidateQueries({ queryKey: ["properties", calendarId] });
    setSelectedPropertyIds((prev) => [...prev, created.id]);
  }
  async function addFeature(name: string) {
    const created = await apiPost<Feature>(`/api/calendars/${calendarId}/features`, { name });
    qc.invalidateQueries({ queryKey: ["features", calendarId] });
    setSelectedFeatureIds((prev) => [...prev, created.id]);
  }
  async function addTargetGroup(name: string) {
    const created = await apiPost<TargetGroup>(`/api/calendars/${calendarId}/target-groups`, {
      name,
    });
    qc.invalidateQueries({ queryKey: ["targetGroups", calendarId] });
    setSelectedTargetGroupIds((prev) => [...prev, created.id]);
  }
  async function addLocation(address: string) {
    const created = await apiPost<Location>(`/api/calendars/${calendarId}/locations`, { address });
    qc.invalidateQueries({ queryKey: ["locations", calendarId] });
    setLocationId(created.id);
  }

  // When map position changes, update the location's lat/lng via PATCH
  const handleMapPositionChange = useCallback(
    async (lat: number, lng: number) => {
      if (!locationId) return;
      await apiPatch(`/api/calendars/${calendarId}/locations/${locationId}`, {
        latitude: lat,
        longitude: lng,
      });
      qc.invalidateQueries({ queryKey: ["locations", calendarId] });
    },
    [locationId, calendarId, qc],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogPortal>
          <DialogOverlay className="bg-scrim supports-backdrop-filter:backdrop-blur-none" />
          <DialogPrimitive.Popup className="ap-dialog fixed top-1/2 left-1/2 z-50 max-h-[90vh] -translate-x-1/2 -translate-y-1/2 outline-none max-[720px]:top-auto max-[720px]:bottom-0 max-[720px]:max-h-[92vh] max-[720px]:translate-y-0 max-[720px]:rounded-b-none sm:w-[min(720px,calc(100%-32px))]">
            <div className="ap-row ap-spread" style={{ alignItems: "flex-start" }}>
              <DialogPrimitive.Title className="t-h2">
                {readOnly
                  ? t("eventModal.viewEvent")
                  : isEditing
                    ? t("eventModal.editEvent")
                    : t("eventModal.newEvent")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                render={<IconButton icon="x" label={t("eventModal.close")} />}
              />
            </div>

            {readOnly && <Banner icon="lock">{t("eventModal.readOnlyNotice")}</Banner>}

            {!isEditing && !readOnly && (
              <div className="ap-seg" role="group" aria-label={t("eventModal.newEvent")}>
                {(["manual", "template"] as const).map((tabOption) => (
                  <button
                    key={tabOption}
                    type="button"
                    aria-pressed={tab === tabOption}
                    onClick={() => setTab(tabOption)}
                  >
                    {tabOption === "template"
                      ? t("eventModal.fromTemplate")
                      : t("eventModal.manual")}
                  </button>
                ))}
              </div>
            )}
            <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
              {tab === "template" && !isEditing ? (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label>{t("eventModal.template")}</Label>
                    <select
                      className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">{t("eventModal.selectTemplate")}</option>
                      {templates.map((tmpl) => (
                        <option key={tmpl.id} value={tmpl.id}>
                          {tmpl.name} ({tmpl.timeBegin}–{tmpl.timeEnd})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Recurrence rule */}
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <Label className="text-xs font-semibold tracking-wide text-slate-600 uppercase">
                      {t("eventModal.recurrenceRule")}
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {(["weekly", "biweekly", "nth-weekday"] as RecurrenceMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => setRecMode(m)}
                          className={`rounded border px-3 py-1.5 text-xs transition-colors ${recMode === m ? "border-blue-300 bg-blue-50 font-medium text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                        >
                          {m === "weekly"
                            ? t("eventModal.weekly")
                            : m === "biweekly"
                              ? t("eventModal.biweekly")
                              : t("eventModal.monthlyNth")}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("eventModal.weekday")}</Label>
                        <select
                          className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                          value={recConfig.weekday}
                          onChange={(e) =>
                            setRecConfig((c) => ({ ...c, weekday: Number(e.target.value) }))
                          }
                        >
                          {WEEKDAYS.map((d, i) => (
                            <option key={i} value={i}>
                              {d}
                            </option>
                          ))}
                        </select>
                      </div>
                      {recMode === "nth-weekday" && (
                        <div className="space-y-1">
                          <Label className="text-xs">{t("eventModal.whichOne")}</Label>
                          <select
                            className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
                            value={recConfig.nth}
                            onChange={(e) =>
                              setRecConfig((c) => ({ ...c, nth: Number(e.target.value) }))
                            }
                          >
                            {NTH_LABELS.map((l, i) => (
                              <option key={i} value={i}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0 space-y-1">
                        <Label className="text-xs">{t("eventModal.from")}</Label>
                        <Input
                          type="date"
                          className="h-8 w-full text-sm"
                          value={recConfig.from}
                          onChange={(e) => setRecConfig((c) => ({ ...c, from: e.target.value }))}
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <Label className="text-xs">{t("eventModal.to")}</Label>
                        <Input
                          type="date"
                          className="h-8 w-full text-sm"
                          value={recConfig.to}
                          onChange={(e) => setRecConfig((c) => ({ ...c, to: e.target.value }))}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="exclude-holidays"
                        checked={excludeHolidays}
                        onChange={(e) => setExcludeHolidays(e.target.checked)}
                        className="border-input h-4 w-4 rounded"
                      />
                      <label htmlFor="exclude-holidays" className="text-sm">
                        {t("eventModal.excludeHolidays")}
                        {loadingHolidays && (
                          <span className="text-muted-foreground ml-1">
                            {t("eventModal.loadingHolidays")}
                          </span>
                        )}
                      </label>
                    </div>
                    {excludeHolidays && generatedDates.length !== effectiveDates.length && (
                      <p className="text-muted-foreground text-xs">
                        {t("eventModal.datesExcluded", {
                          count: generatedDates.length - effectiveDates.length,
                        })}
                      </p>
                    )}

                    {generatedDates.length > 0 ? (
                      <div>
                        <p className="mb-1.5 text-xs text-slate-500">
                          {t("eventModal.eventsWillBeCreated", { count: effectiveDates.length })}
                        </p>
                        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                          {effectiveDates.map((d) => (
                            <span
                              key={d}
                              className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : recConfig.from && recConfig.to ? (
                      <p className="text-xs text-slate-400">{t("eventModal.noMatchingDates")}</p>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      id="draft-s"
                      checked={!isDraft}
                      onCheckedChange={(v) => setIsDraft(!v)}
                    />
                    <Label htmlFor="draft-s">{t("eventModal.published")}</Label>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Name + time */}
                  <div className="space-y-1">
                    <Label htmlFor="evt-n">{t("eventModal.eventName")}</Label>
                    <Input
                      id="evt-n"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t("eventModal.eventNamePlaceholder")}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <div className="min-w-36 flex-1 space-y-1">
                      <Label htmlFor="evt-d">{t("eventModal.startDate")}</Label>
                      <Input
                        id="evt-d"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    <div className="min-w-36 flex-1 space-y-1">
                      <Label htmlFor="evt-de">
                        {t("eventModal.endDate")}{" "}
                        <span className="font-normal text-slate-400">
                          {t("eventModal.endDateOptional")}
                        </span>
                      </Label>
                      <Input
                        id="evt-de"
                        type="date"
                        value={dateEnd}
                        min={date}
                        onChange={(e) => setDateEnd(e.target.value)}
                        className="w-full"
                      />
                    </div>
                    {!isAllDay && (
                      <>
                        <div className="min-w-28 space-y-1">
                          <Label>{t("eventModal.startTime")}</Label>
                          <Input
                            type="time"
                            value={timeBegin}
                            onChange={(e) => setTimeBegin(e.target.value)}
                            className="w-full"
                          />
                        </div>
                        <div className="min-w-28 space-y-1">
                          <Label>{t("eventModal.endTime")}</Label>
                          <Input
                            type="time"
                            value={timeEnd}
                            onChange={(e) => setTimeEnd(e.target.value)}
                            className="w-full"
                          />
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch id="evt-allday" checked={isAllDay} onCheckedChange={setIsAllDay} />
                      <Label htmlFor="evt-allday">{t("eventModal.allDay")}</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="evt-pub"
                        checked={!isDraft}
                        onCheckedChange={(v) => setIsDraft(!v)}
                      />
                      <Label htmlFor="evt-pub">
                        {t("eventModal.published")}{" "}
                        {isDraft && (
                          <span className="text-xs text-slate-400">
                            {t("eventModal.draftLabel")}
                          </span>
                        )}
                      </Label>
                    </div>
                  </div>

                  {/* Location with inline create + map */}
                  <div className="space-y-1.5">
                    <Label>{t("eventModal.location")}</Label>
                    <div className="flex gap-1.5">
                      <select
                        className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm"
                        value={locationId}
                        onChange={(e) => {
                          setLocationId(e.target.value);
                          setShowMap(false);
                        }}
                      >
                        <option value="">{t("eventModal.noLocation")}</option>
                        {locations.map((l) => (
                          <option key={l.id} value={String(l.id)}>
                            {formatLocationLabel(l)}
                          </option>
                        ))}
                      </select>
                      {locationId !== "" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 px-2.5 text-xs"
                          onClick={() => setShowMap((m) => !m)}
                        >
                          {showMap ? t("eventModal.hideMap") : t("eventModal.map")}
                        </Button>
                      )}
                    </div>
                    {showMap && locationId !== "" && selectedLocation && (
                      <Suspense
                        fallback={<div className="h-48 animate-pulse rounded-lg bg-slate-100" />}
                      >
                        <MapPicker
                          latitude={selectedLocation.latitude}
                          longitude={selectedLocation.longitude}
                          address={formatAddress(selectedLocation) || undefined}
                          onPositionChange={handleMapPositionChange}
                        />
                      </Suspense>
                    )}
                    <InlineCreate
                      label={t("eventModal.newLocation")}
                      placeholder={t("eventModal.address")}
                      onAdd={addLocation}
                    />
                  </div>

                  {/* Properties */}
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
                    <InlineCreate
                      label={t("eventModal.newProperty")}
                      placeholder={t("eventModal.propertyName")}
                      onAdd={addProperty}
                    />
                  </div>

                  {/* Features */}
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
                    <InlineCreate
                      label={t("eventModal.newFeature")}
                      placeholder={t("eventModal.featureName")}
                      onAdd={addFeature}
                    />
                  </div>

                  {/* Target groups */}
                  <div className="space-y-1.5">
                    <Label>{t("eventModal.targetGroups")}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {targetGroups.map((tg) => (
                        <button
                          key={tg.id}
                          type="button"
                          onClick={() =>
                            setSelectedTargetGroupIds(toggle(selectedTargetGroupIds, tg.id))
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${selectedTargetGroupIds.includes(tg.id) ? "border-purple-300 bg-purple-100 text-purple-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                        >
                          {tg.name}
                        </button>
                      ))}
                    </div>
                    <InlineCreate
                      label={t("eventModal.newTargetGroup")}
                      placeholder={t("eventModal.groupName")}
                      onAdd={addTargetGroup}
                    />
                  </div>
                </div>
              )}
            </fieldset>

            <div className="ap-dialog-foot" style={{ justifyContent: "space-between" }}>
              <div>
                {isEditing && !readOnly && (
                  <DsButton
                    variant="ghost-danger"
                    icon="trash"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    {t("common.delete")}
                  </DsButton>
                )}
              </div>
              <div className="ap-actions">
                {readOnly ? (
                  <DsButton variant="secondary" onClick={onClose}>
                    {t("eventModal.close")}
                  </DsButton>
                ) : (
                  <>
                    <DsButton variant="secondary" onClick={onClose}>
                      {t("common.cancel")}
                    </DsButton>
                    <DsButton
                      loading={loading}
                      loadingLabel={t("eventModal.saving")}
                      disabled={tab === "template" && effectiveDates.length === 0 && !isEditing}
                      onClick={tab === "template" && !isEditing ? handleCreateSeries : handleSubmit}
                    >
                      {isEditing
                        ? t("common.save")
                        : tab === "template"
                          ? t("eventModal.createEvents", { count: effectiveDates.length })
                          : t("common.create")}
                    </DsButton>
                  </>
                )}
              </div>
            </div>
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>

      {event && (
        <ConfirmDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title={t("eventModal.deleteEvent")}
          description={t("eventModal.deleteText", { name: event.name })}
          consequence={t("eventModal.deleteConsequence")}
          confirmLabel={t("common.delete")}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}
