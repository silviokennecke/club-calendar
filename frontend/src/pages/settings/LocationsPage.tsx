import { useState, lazy, Suspense } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import type { Location } from "@/lib/types";
import { formatAddress, formatLocationLabel } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, EmptyState } from "@/components/ui/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MapPin, Pencil, Trash2 } from "lucide-react";
import type { GeocodedAddress } from "@/components/locations/MapPicker";
import { useTranslation } from "react-i18next";

void formatLocationLabel;

const MapPicker = lazy(() => import("@/components/locations/MapPicker"));
const LocationsOverviewMap = lazy(() => import("@/components/locations/LocationsOverviewMap"));

interface FormState {
  name: string;
  street: string;
  zip: string;
  city: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

const emptyForm: FormState = {
  name: "",
  street: "",
  zip: "",
  city: "",
  country: "",
  latitude: null,
  longitude: null,
};

export default function LocationsPage() {
  const { t } = useTranslation();
  const { calendarId } = useParams<{ calendarId: string }>();
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["locations", calendarId],
    queryFn: () => apiGet(`/api/calendars/${calendarId}/locations`),
  });

  const locationsWithCoords = locations.filter(
    (l): l is Location & { latitude: number; longitude: number } =>
      l.latitude != null && l.longitude != null,
  );

  function openCreate() {
    setEditingLocation(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(loc: Location) {
    setEditingLocation(loc);
    setForm({
      name: loc.name ?? "",
      street: loc.street ?? "",
      zip: loc.zip ?? "",
      city: loc.city ?? "",
      country: loc.country ?? "",
      latitude: loc.latitude ?? null,
      longitude: loc.longitude ?? null,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingLocation(null);
    setForm(emptyForm);
  }

  function handleMapPosition(lat: number, lng: number, geocoded: GeocodedAddress) {
    setForm((f) => ({
      ...f,
      latitude: lat,
      longitude: lng,
      street: f.street || geocoded.street || "",
      zip: f.zip || geocoded.zip || "",
      city: f.city || geocoded.city || "",
      country: f.country || geocoded.country || "",
    }));
  }

  const mapPickerAddress = formatAddress(form) || form.street || undefined;

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim() || null,
        street: form.street.trim() || null,
        zip: form.zip.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        latitude: form.latitude,
        longitude: form.longitude,
      };
      if (editingLocation) {
        await apiPatch(`/api/calendars/${calendarId}/locations/${editingLocation.id}`, payload);
      } else {
        await apiPost(`/api/calendars/${calendarId}/locations`, payload);
      }
      qc.invalidateQueries({ queryKey: ["locations", calendarId] });
      closeModal();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await apiDelete(`/api/calendars/${calendarId}/locations/${deleteTarget.id}`);
    qc.invalidateQueries({ queryKey: ["locations", calendarId] });
    setDeleteTarget(null);
  }

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{t("settings.locations.description")}</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("settings.locations.newLocation")}
        </Button>
      </div>

      {locationsWithCoords.length > 0 && (
        <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-slate-100" />}>
          <LocationsOverviewMap
            locations={locationsWithCoords}
            selectedId={hoveredId}
            onSelect={(id) => {
              const loc = locations.find((l) => l.id === id);
              if (loc) openEdit(loc);
            }}
            height="h-72"
          />
        </Suspense>
      )}

      {locations.length === 0 ? (
        <EmptyState icon="map-pin" title={t("settings.locations.noLocations")} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => {
            const addr = formatAddress(loc);
            void addr;
            return (
              <div
                key={loc.id}
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-blue-200 hover:shadow-sm"
                onMouseEnter={() => setHoveredId(loc.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => openEdit(loc)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <MapPin
                      className={`mt-0.5 h-4 w-4 shrink-0 transition-colors ${loc.latitude != null ? "text-blue-500" : "text-slate-300"}`}
                    />
                    <div className="min-w-0">
                      {loc.name && (
                        <p className="truncate text-sm font-semibold text-slate-900">{loc.name}</p>
                      )}
                      {loc.street && (
                        <p
                          className={`truncate text-sm ${loc.name ? "text-slate-500" : "font-medium text-slate-800"}`}
                        >
                          {loc.street}
                        </p>
                      )}
                      {(loc.zip || loc.city) && (
                        <p className="truncate text-sm text-slate-400">
                          {[loc.zip, loc.city].filter(Boolean).join(" ")}
                        </p>
                      )}
                      {loc.latitude != null && (
                        <p className="mt-0.5 font-mono text-xs text-slate-400">
                          {loc.latitude.toFixed(4)}, {loc.longitude!.toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(loc);
                      }}
                      className="rounded p-1 text-slate-400 hover:text-slate-600"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(loc);
                      }}
                      className="rounded p-1 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={(v) => !v && closeModal()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingLocation ? t("common.edit") : t("settings.locations.newLocation")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <Field label={t("settings.locations.nameOptional")}>
              <Input
                placeholder="e.g. Main Hall"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>

            <Field label={t("settings.locations.street")}>
              <Input
                placeholder="Musterstraße 1"
                value={form.street}
                onChange={(e) => setForm((f) => ({ ...f, street: e.target.value }))}
              />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label={t("settings.locations.zip")}>
                <Input
                  placeholder="12345"
                  value={form.zip}
                  onChange={(e) => setForm((f) => ({ ...f, zip: e.target.value }))}
                />
              </Field>
              <Field label={t("settings.locations.city")} className="col-span-2">
                <Input
                  placeholder="Berlin"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                />
              </Field>
            </div>

            <Field
              label={
                <>
                  {t("settings.locations.country")}{" "}
                  <span className="font-normal text-slate-400">
                    {t("settings.locations.optional")}
                  </span>
                </>
              }
            >
              <Input
                placeholder="Germany"
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              />
            </Field>

            <Field
              group
              label={
                <>
                  {t("settings.locations.mapPosition")}{" "}
                  <span className="font-normal text-slate-400">
                    ({t("settings.locations.mapPositionHint")})
                  </span>
                </>
              }
            >
              <Suspense fallback={<div className="h-56 animate-pulse rounded-lg bg-slate-100" />}>
                <MapPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  address={mapPickerAddress}
                  onPositionChange={handleMapPosition}
                />
              </Suspense>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={closeModal}>
              {t("common.cancel")}
            </Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving
                ? t("common.saving")
                : editingLocation
                  ? t("common.save")
                  : t("settings.locations.addLocation")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.locations.deleteLocation")}</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;
              {deleteTarget
                ? (deleteTarget.name ?? formatAddress(deleteTarget) ?? "this location")
                : ""}
              &rdquo; {t("settings.locations.cannotBeUndone")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
