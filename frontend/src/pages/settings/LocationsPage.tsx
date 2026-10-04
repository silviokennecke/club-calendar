import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  UnsavedChangesDialog,
  toast,
  type ErrorSummaryItem,
} from "@/components/ui/shared";
import { LocationPanel } from "@/components/locations/LocationPanel";
import { MapBoundary } from "@/components/locations/MapBoundary";
import type { AddressSuggestion } from "@/components/locations/AddressSearch";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { useSettingsPage } from "@/components/settings/useSettingsPage";
import { apiDelete, apiFetch, apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatAddress, type CalendarEvent, type EventTemplate, type Location } from "@/lib/types";
import {
  EMPTY_LOCATION_FORM,
  countLocationUsage,
  fillEmptyAddress,
  hasPosition,
  locationFormValid,
  locationPayload,
  locationToForm,
  placeTitle,
  sameLocationForm,
  type AddressField,
  type GeocodedAddress,
  type LocationForm,
} from "@/lib/settings";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

const LocationsOverviewMap = lazy(() => import("@/components/locations/LocationsOverviewMap"));

/**
 * Settings "Orte" (design: SettingsPlaces, SettingsPlacesMobile): overview map and list on the
 * left, form panel on the right (stacked on phones). The list and the form are the full way to
 * manage places; the maps are an addition (text alternative, coordinate fields).
 */
export default function LocationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const page = useSettingsPage();
  const { calendarId, readOnly } = page;
  const queryKey = ["locations", calendarId];

  const list = useQuery<Location[]>({
    queryKey,
    queryFn: () => apiGet<Location[]>(`/api/calendars/${calendarId}/locations`),
  });
  const places = useMemo(() => list.data ?? [], [list.data]);

  // editId: place in the form, null = new place
  const [editId, setEditId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationForm>(EMPTY_LOCATION_FORM);
  const [baseline, setBaseline] = useState<LocationForm>(EMPTY_LOCATION_FORM);
  const [filled, setFilled] = useState<AddressField[]>([]);
  const [invalid, setInvalid] = useState(false);
  // Text in the coordinate fields that is not a number: it is not part of `form` (it parses to null),
  // so saving would silently drop it. `coordRefused` = a save was refused because of it.
  const [coordErrors, setCoordErrors] = useState<ErrorSummaryItem[]>([]);
  const [coordRefused, setCoordRefused] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<Location | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reverseSeq = useRef(0);

  const dirty = !sameLocationForm(form, baseline);
  const guard = useUnsavedChanges(dirty);
  const editing = editId ? places.find((p) => p.id === editId) : undefined;

  const usage = useQuery({
    queryKey: ["usage", "locations", calendarId],
    enabled: !!deleting,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [events, templates] = await Promise.all([
        apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
        apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`),
      ]);
      return { events, templates };
    },
  });

  function load(id: string | null, next: LocationForm, select: string | null) {
    reverseSeq.current++;
    setEditId(id);
    setSelectedId(select);
    setForm(next);
    setBaseline(next);
    setFilled([]);
    setInvalid(false);
    setCoordErrors([]);
    setCoordRefused(false);
    setFormKey((k) => k + 1);
    setFailed(false);
  }

  function focusPanel() {
    setTimeout(() => {
      const panel = document.getElementById("place-panel");
      panel?.scrollIntoView?.({ block: "start" });
      headingRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  function startNew() {
    guard.guard(() => {
      load(null, EMPTY_LOCATION_FORM, null);
      focusPanel();
    });
  }

  function startEdit(loc: Location) {
    guard.guard(() => {
      load(loc.id, locationToForm(loc), loc.id);
      focusPanel();
    });
  }

  function change(patch: Partial<LocationForm>) {
    setForm((f) => ({ ...f, ...patch }));
    setInvalid(false);
    setFailed(false);
    if ("street" in patch || "zip" in patch || "city" in patch || "country" in patch) {
      setFilled([]);
    }
  }

  function onSuggestion(s: AddressSuggestion) {
    reverseSeq.current++;
    setFilled([]);
    setInvalid(false);
    setForm((f) => ({
      ...f,
      street: s.street ?? "",
      zip: s.zip ?? "",
      city: s.city ?? "",
      country: s.country ?? "",
      latitude: s.lat,
      longitude: s.lng,
    }));
  }

  async function onPick(latitude: number, longitude: number) {
    const mine = ++reverseSeq.current;
    setForm((f) => ({ ...f, latitude, longitude }));
    setInvalid(false);
    try {
      const res = await apiFetch(`/api/map/geocode/reverse?lat=${latitude}&lng=${longitude}`);
      if (!res.ok || mine !== reverseSeq.current) return;
      const geo = (await res.json()) as GeocodedAddress;
      setForm((f) => {
        const result = fillEmptyAddress(f, geo);
        setFilled(result.filled);
        return result.form;
      });
    } catch {
      // The position stays; the address fields can be typed.
    }
  }

  async function save() {
    const nameMissing = !locationFormValid(form);
    if (nameMissing || coordErrors.length > 0) {
      setInvalid(nameMissing);
      setCoordRefused(coordErrors.length > 0);
      setSignal((n) => n + 1);
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const payload = locationPayload(form);
      const saved = editId
        ? await apiPatch<Location>(`/api/calendars/${calendarId}/locations/${editId}`, payload)
        : await apiPost<Location>(`/api/calendars/${calendarId}/locations`, payload);
      await qc.invalidateQueries({ queryKey });
      // Events and templates show the place.
      void qc.invalidateQueries({ queryKey: ["events", calendarId] });
      void qc.invalidateQueries({ queryKey: ["templates", calendarId] });
      const next = locationToForm(saved);
      setEditId(saved.id);
      setSelectedId(saved.id);
      setForm(next);
      setBaseline(next);
      setFilled([]);
      toast.success(t("settings.places.saved"));
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (editing) {
      load(editing.id, locationToForm(editing), editing.id);
    } else {
      load(null, EMPTY_LOCATION_FORM, null);
    }
  }

  async function confirmDelete(loc: Location) {
    try {
      await apiDelete(`/api/calendars/${calendarId}/locations/${loc.id}`);
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["events", calendarId] });
      void qc.invalidateQueries({ queryKey: ["templates", calendarId] });
      load(null, EMPTY_LOCATION_FORM, null);
      toast.success(t("settings.places.deleted", { name: placeTitle(loc) ?? "" }));
      focusPanel();
    } catch {
      toast.error(t("settings.places.deleteFailed"));
    }
  }

  function consequence() {
    if (!deleting) return "";
    if (usage.isError) return t("settings.places.delete.consequence.unknown");
    if (!usage.data) return t("settings.places.delete.consequence.loading");
    const n = countLocationUsage(deleting.id, usage.data.events, usage.data.templates);
    const parts: string[] = [];
    if (n.events > 0)
      parts.push(t("settings.places.delete.consequence.events", { count: n.events }));
    if (n.templates > 0)
      parts.push(t("settings.places.delete.consequence.templates", { count: n.templates }));
    return parts.length > 0 ? parts.join(" ") : t("settings.places.delete.consequence.none");
  }

  // Stable identity: the map re-frames its pins whenever this array changes (not on every keystroke).
  const pins = useMemo(
    () =>
      places.filter(hasPosition).map((p) => ({
        id: p.id,
        title: placeTitle(p) ?? t("settings.places.unnamed"),
        latitude: p.latitude!,
        longitude: p.longitude!,
      })),
    [places, t],
  );

  let listArea;
  if (list.isLoading) {
    listArea = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("settings.places.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 220 }} />
        <Skeleton style={{ display: "block", height: 160 }} />
      </div>
    );
  } else if (list.isError && !list.data) {
    listArea = (
      <Banner
        tone="danger"
        title={t("settings.places.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void list.refetch()}>
            {t("settings.places.loadError.retry")}
          </Button>
        }
      >
        {t("settings.places.loadError.text")}
      </Banner>
    );
  } else if (places.length === 0) {
    listArea = (
      <div className="ap-panel">
        <EmptyState
          icon="map-pin"
          title={t("settings.places.empty.title")}
          text={readOnly ? t("settings.places.empty.readOnly") : t("settings.places.empty.text")}
          actions={
            readOnly ? undefined : (
              <Button icon="plus" onClick={startNew}>
                {t("settings.places.create")}
              </Button>
            )
          }
        />
      </div>
    );
  } else {
    listArea = (
      <>
        {pins.length > 0 ? (
          <>
            <p className="ap-sr" id="pl-overview-desc">
              {t("settings.places.overviewDesc", { count: pins.length })}
            </p>
            <MapBoundary
              fallback={
                <p className="ap-panel ap-panel--sunken t-sm">{t("settings.places.mapFailed")}</p>
              }
            >
              <Suspense fallback={<Skeleton style={{ display: "block", height: 360 }} />}>
                <LocationsOverviewMap
                  locations={pins}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  label={t("settings.places.overview", { count: pins.length })}
                  describedBy="pl-overview-desc"
                  note={t("settings.places.overviewNote")}
                />
              </Suspense>
            </MapBoundary>
          </>
        ) : (
          <p className="ap-panel ap-panel--sunken t-sm t-muted">{t("settings.places.noPins")}</p>
        )}
        <section className="ap-stack ap-stack--sm" aria-labelledby="pl-list-h">
          <h2 className="t-h3" id="pl-list-h">
            {t("settings.places.listTitle", { count: places.length })}
          </h2>
          <ul className="ap-panel ap-panel--flush ap-list">
            {places.map((loc) => {
              const title = placeTitle(loc) ?? t("settings.places.unnamed");
              const marked = selectedId === loc.id;
              return (
                <li
                  key={loc.id}
                  className={`ap-listrow ap-listrow--wrap${marked ? "ap-listrow--current" : ""}`}
                  aria-current={marked || undefined}
                >
                  <div className="ap-listrow-main" style={{ minWidth: 180 }}>
                    <b>{title}</b>
                    <span>
                      {loc.name ? formatAddress(loc) : formatAddress({ ...loc, street: "" })}
                    </span>
                    {marked && (
                      <span
                        className="ap-badge ap-badge--public"
                        style={{ display: "inline-flex", marginTop: "var(--space-1)" }}
                      >
                        <Icon glyph="check" size={14} />
                        {editId === loc.id && !readOnly
                          ? t("settings.places.inForm")
                          : t("settings.places.marked")}
                      </span>
                    )}
                  </div>
                  <div className="ap-actions">
                    {hasPosition(loc) ? (
                      <Button
                        variant="secondary"
                        icon="map-pin"
                        aria-pressed={marked}
                        aria-label={t("settings.places.showLabel", { name: title })}
                        onClick={() => setSelectedId(loc.id)}
                      >
                        {t("settings.places.show")}
                      </Button>
                    ) : (
                      <span className="t-sm t-muted">{t("settings.places.noPosition")}</span>
                    )}
                    {!readOnly && (
                      <IconButton
                        icon="edit"
                        label={t("settings.places.editLabel", { name: title })}
                        onClick={() => startEdit(loc)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </>
    );
  }

  return (
    <SettingsLayout
      wide
      actions={
        !readOnly && (
          <Button icon="plus" onClick={startNew}>
            {t("settings.places.create")}
          </Button>
        )
      }
    >
      <p className="t-body t-muted t-prose">{t("settings.places.description")}</p>
      <div className="ap-split">
        <div className="ap-stack">{listArea}</div>
        {!readOnly && (
          <LocationPanel
            isNew={!editId}
            placeName={editing ? (placeTitle(editing) ?? t("settings.places.unnamed")) : undefined}
            form={form}
            onChange={change}
            onSuggestion={onSuggestion}
            onPick={(lat, lng) => void onPick(lat, lng)}
            filled={filled}
            invalid={invalid}
            coordinateErrors={coordRefused ? coordErrors : []}
            onCoordinateErrors={setCoordErrors}
            formKey={formKey}
            signal={signal}
            saving={saving}
            failed={failed}
            onSave={() => void save()}
            onCancel={cancel}
            onDelete={editing ? () => setDeleting(editing) : undefined}
            headingRef={headingRef}
          />
        )}
      </div>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={t("settings.places.delete.title", {
            name: placeTitle(deleting) ?? t("settings.places.unnamed"),
          })}
          description={t("settings.places.delete.text")}
          consequence={consequence()}
          confirmLabel={t("settings.places.delete.confirm")}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
      <UnsavedChangesDialog {...guard.dialog} />
    </SettingsLayout>
  );
}
