import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AutocompleteInput,
  Banner,
  Field,
  Skeleton,
  TextInput,
  type ErrorSummaryItem,
} from "@/components/ui/shared";
import type { AddressField, LocationForm } from "@/lib/settings";
import { blurFillPatch, fetchAddressSuggestions, type AddressSuggestion } from "./addressSuggest";
import { CoordinateFields } from "./CoordinateFields";
import { MapBoundary } from "./MapBoundary";

const PositionMap = lazy(() => import("./PositionMap"));

interface LocationFieldsProps {
  form: LocationForm;
  onChange: (patch: Partial<LocationForm>) => void;
  onSuggestion: (s: AddressSuggestion) => void;
  onPick: (latitude: number, longitude: number) => void;
  /** Address fields filled in from the picked position (info banner). */
  filled: AddressField[];
  invalid: boolean;
  onCoordinateErrors: (errors: ErrorSummaryItem[]) => void;
  /** Changes whenever another place is loaded, so the typed texts of the search and coordinate fields reset. */
  formKey: number;
}

/** Fields of the place form (search, name, address, position map and coordinates), shared by the places page and the event form's "new place" dialog. */
export function LocationFields({
  form,
  onChange,
  onSuggestion,
  onPick,
  filled,
  invalid,
  onCoordinateErrors,
  formKey,
}: LocationFieldsProps) {
  const { t } = useTranslation();
  const formRef = useRef(form);
  formRef.current = form;
  const pickedRef = useRef(false);
  const blurSeq = useRef(0);
  const [suggestStatus, setSuggestStatus] = useState<"ok" | "limit" | "error">("ok");
  useEffect(() => () => void blurSeq.current++, []);

  const proximity = () => {
    const f = formRef.current;
    return f.latitude != null && f.longitude != null ? { lat: f.latitude, lng: f.longitude } : null;
  };

  async function searchStreet(street: string, signal: AbortSignal) {
    const f = formRef.current;
    const q = [street, f.zip.trim(), f.city.trim()].filter(Boolean).join(" ");
    const out = await fetchAddressSuggestions(q, proximity(), undefined, signal);
    if (signal.aborted) return [];
    if (out.status !== "ok") {
      setSuggestStatus(out.status);
      return [];
    }
    setSuggestStatus("ok");
    return out.suggestions.map((s, i) => ({ ...s, id: `${i}-${s.label}` }));
  }

  async function onStreetBlur() {
    const f = formRef.current;
    const street = f.street.trim();
    if (pickedRef.current || street.length < 2) return;
    if (f.zip.trim() || f.city.trim() || f.country.trim()) return;
    const mine = ++blurSeq.current;
    const out = await fetchAddressSuggestions(street, proximity());
    if (out.status !== "ok" || mine !== blurSeq.current) return;
    if (formRef.current.street.trim() !== street) return;
    const patch = blurFillPatch(formRef.current, out.suggestions);
    if (Object.keys(patch).length > 0) onChange(patch);
  }

  function pick(s: AddressSuggestion) {
    blurSeq.current++;
    pickedRef.current = true;
    onSuggestion(s);
  }
  const fieldNames = filled.map((f) => t(`settings.places.fields.${f}`)).join(", ");
  const text = (key: "name" | "street" | "zip" | "city" | "country") => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
  });

  return (
    <>
      {filled.length > 0 && (
        <Banner tone="info">{t("settings.places.filled", { fields: fieldNames })}</Banner>
      )}

      <Field
        id="pl-name"
        label={t("settings.places.nameLabel")}
        optional
        error={invalid ? t("settings.places.nameOrStreet") : undefined}
      >
        <TextInput
          maxLength={255}
          placeholder={t("settings.places.namePlaceholder")}
          autoComplete="off"
          {...text("name")}
        />
      </Field>
      <Field
        id="pl-street"
        label={t("settings.places.streetLabel")}
        hint={suggestStatus === "ok" ? undefined : t(`settings.places.suggest.${suggestStatus}`)}
      >
        <AutocompleteInput
          key={formKey}
          maxLength={255}
          minChars={2}
          maxResults={6}
          value={form.street}
          onValueChange={(street) => {
            pickedRef.current = false;
            blurSeq.current++;
            onChange({ street });
          }}
          onSearch={searchStreet}
          getLabel={(s: AddressSuggestion) => s.street || s.label}
          renderItem={(s: AddressSuggestion) => s.label}
          onSelect={pick}
          onBlur={() => void onStreetBlur()}
        />
      </Field>
      <div className="ap-inputrow">
        <Field id="pl-zip" label={t("settings.places.zipLabel")}>
          <TextInput maxLength={20} autoComplete="off" {...text("zip")} />
        </Field>
        <Field id="pl-city" label={t("settings.places.cityLabel")}>
          <TextInput maxLength={255} autoComplete="off" {...text("city")} />
        </Field>
      </div>
      <Field id="pl-country" label={t("settings.places.countryLabel")}>
        <TextInput maxLength={100} autoComplete="off" {...text("country")} />
      </Field>

      <div className="ap-stack ap-stack--sm">
        <MapBoundary
          fallback={
            <p className="ap-panel ap-panel--sunken t-sm">{t("settings.places.mapFailed")}</p>
          }
        >
          <Suspense fallback={<Skeleton style={{ display: "block", height: 260 }} />}>
            <PositionMap
              latitude={form.latitude}
              longitude={form.longitude}
              onPick={onPick}
              label={t("settings.places.positionMap")}
              describedBy="pl-map-hint"
              note={t("settings.places.positionNote")}
            />
          </Suspense>
        </MapBoundary>
        <p className="t-sm t-muted" id="pl-map-hint">
          {t("settings.places.positionHint")}
        </p>
        <CoordinateFields
          key={formKey}
          onErrorsChange={onCoordinateErrors}
          latitude={form.latitude}
          longitude={form.longitude}
          onChange={(latitude, longitude) => onChange({ latitude, longitude })}
        />
      </div>
    </>
  );
}
