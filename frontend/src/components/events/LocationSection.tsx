import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Location } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import { locationName } from "@/lib/events";
import { Button, Field, NativeSelect, Skeleton, TextInput, toast } from "@/components/ui/shared";

const EventLocationMap = lazy(() => import("./EventLocationMap"));

interface LocationSectionProps {
  locations: Location[];
  value: string;
  onChange: (locationId: string) => void;
  onCreate: (name: string) => Promise<Location>;
  onMove: (locationId: string, latitude: number, longitude: number) => Promise<void>;
  readOnly?: boolean;
}

/**
 * "Ort" section of the event form (design: EventForm): select, address, correct the position on
 * the map, create a new location inline.
 */
export function LocationSection({
  locations,
  value,
  onChange,
  onCreate,
  onMove,
  readOnly,
}: LocationSectionProps) {
  const { t } = useTranslation();
  const [fixing, setFixing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const selected = locations.find((l) => l.id === value);
  const hasPosition = selected?.latitude != null && selected?.longitude != null;

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await onCreate(name);
      onChange(created.id);
      setCreating(false);
      setNewName("");
    } catch {
      toast.error(t("events.form.place.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function move(lat: number, lng: number) {
    if (!selected) return;
    try {
      await onMove(selected.id, lat, lng);
      toast.success(t("events.form.place.positionSaved"));
    } catch {
      toast.error(t("events.form.place.positionFailed"));
    }
  }

  return (
    <div className="ap-cols-2" style={{ alignItems: "start" }}>
      <div className="ap-stack">
        <Field id="ev-place" label={t("events.form.place.label")} optional>
          <NativeSelect
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setFixing(false);
            }}
          >
            <option value="">{t("events.form.place.none")}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {locationName(l)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {selected && (
          <>
            <p className="t-sm t-muted">
              {formatAddress(selected) || t("events.form.place.noAddress")}
            </p>
            {!readOnly && (
              <div className="ap-actions">
                <Button
                  variant="secondary"
                  icon="locate"
                  aria-pressed={fixing}
                  onClick={() => setFixing((f) => !f)}
                >
                  {t("events.form.place.fix")}
                </Button>
              </div>
            )}
            {fixing && (
              <p className="t-sm" role="status">
                {t("events.form.place.fixHint")}
              </p>
            )}
          </>
        )}
        {!readOnly && !creating && (
          <div>
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => {
                setCreating(true);
                setNewName("");
              }}
            >
              {t("events.form.place.create")}
            </Button>
          </div>
        )}
        {creating && (
          <div className="ap-stack ap-panel ap-panel--sunken">
            <Field id="ev-newplace" label={t("events.form.place.newName")}>
              <TextInput
                value={newName}
                autoFocus
                placeholder={t("events.form.place.newPlaceholder")}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void create();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setCreating(false);
                  }
                }}
              />
            </Field>
            <div className="ap-actions">
              <Button onClick={create} loading={busy} disabled={!newName.trim()}>
                {t("events.form.place.createAndAssign")}
              </Button>
              <Button variant="ghost" onClick={() => setCreating(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="ap-stack">
        {selected ? (
          <>
            <Suspense fallback={<Skeleton style={{ display: "block", height: 220 }} />}>
              <EventLocationMap
                key={selected.id}
                location={selected}
                fixing={fixing}
                onMove={move}
                label={t("events.form.place.map", { name: locationName(selected) })}
                note={fixing ? t("events.form.place.fixHint") : locationName(selected)}
              />
            </Suspense>
            {!hasPosition && <p className="t-sm t-muted">{t("events.form.place.noPosition")}</p>}
          </>
        ) : (
          <p className="ap-panel ap-panel--sunken t-sm t-muted">{t("events.form.place.empty")}</p>
        )}
      </div>
    </div>
  );
}
