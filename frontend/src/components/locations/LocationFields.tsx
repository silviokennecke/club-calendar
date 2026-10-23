import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Field, Skeleton, TextInput, type ErrorSummaryItem } from "@/components/ui/shared";
import type { AddressField, LocationForm } from "@/lib/settings";
import { AddressSearch, type AddressSuggestion } from "./AddressSearch";
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
  const has = form.latitude != null && form.longitude != null;
  const fieldNames = filled.map((f) => t(`settings.places.fields.${f}`)).join(", ");
  const text = (key: "name" | "street" | "zip" | "city" | "country") => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
  });

  return (
    <>
      <AddressSearch
        key={formKey}
        onPick={onSuggestion}
        proximity={has ? { lat: form.latitude!, lng: form.longitude! } : null}
      />

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
      <Field id="pl-street" label={t("settings.places.streetLabel")}>
        <TextInput maxLength={255} autoComplete="off" {...text("street")} />
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
