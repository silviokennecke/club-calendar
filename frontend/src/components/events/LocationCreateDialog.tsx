import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ErrorSummary,
  FormDialog,
  type ErrorSummaryItem,
} from "@/components/ui/shared";
import { LocationFields } from "@/components/locations/LocationFields";
import type { AddressSuggestion } from "@/components/locations/addressSuggest";
import { apiFetch } from "@/lib/api";
import type { Location } from "@/lib/types";
import {
  EMPTY_LOCATION_FORM,
  fillEmptyAddress,
  locationFormValid,
  locationPayload,
  type AddressField,
  type GeocodedAddress,
  type LocationForm,
} from "@/lib/settings";

interface LocationCreateDialogProps {
  initialName: string;
  onCreate: (payload: ReturnType<typeof locationPayload>) => Promise<Location>;
  onCreated: (location: Location) => void;
  onClose: () => void;
}

/**
 * "Neuer Ort" dialog above the event form: same fields and position picking as the places page.
 * Mounted only while open, so every opening starts with an empty form.
 */
export function LocationCreateDialog({
  initialName,
  onCreate,
  onCreated,
  onClose,
}: LocationCreateDialogProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<LocationForm>({ ...EMPTY_LOCATION_FORM, name: initialName });
  const [filled, setFilled] = useState<AddressField[]>([]);
  const [invalid, setInvalid] = useState(false);
  const [coordErrors, setCoordErrors] = useState<ErrorSummaryItem[]>([]);
  const [coordRefused, setCoordRefused] = useState(false);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const reverseSeq = useRef(0);

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
      onCreated(await onCreate(locationPayload(form)));
    } catch {
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <FormDialog
      open
      wide
      onOpenChange={(open) => !open && !saving && onClose()}
      title={t("events.form.place.dialog.title")}
      description={t("events.form.place.dialog.description")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={saving}>
            {t("events.form.place.dialog.save")}
          </Button>
        </>
      }
    >
      <ErrorSummary
        title={
          invalid ? t("settings.places.errorSummary") : t("settings.places.errorSummaryCoordinates")
        }
        errors={[
          ...(invalid ? [{ fieldId: "pl-name", message: t("settings.places.nameOrStreet") }] : []),
          ...(coordRefused ? coordErrors : []),
        ]}
        focusSignal={signal}
      />
      {failed && (
        <Banner tone="danger" title={t("events.form.place.createFailed")}>
          {t("events.form.place.dialog.failedText")}
        </Banner>
      )}
      <LocationFields
        form={form}
        onChange={change}
        onSuggestion={onSuggestion}
        onPick={(lat, lng) => void onPick(lat, lng)}
        filled={filled}
        invalid={invalid}
        onCoordinateErrors={setCoordErrors}
        formKey={0}
      />
    </FormDialog>
  );
}
