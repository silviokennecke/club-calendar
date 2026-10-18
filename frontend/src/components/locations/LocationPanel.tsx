import { lazy, Suspense, type Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ErrorSummary,
  Field,
  Skeleton,
  TextInput,
  type ErrorSummaryItem,
} from "@/components/ui/shared";
import type { AddressField, LocationForm } from "@/lib/settings";
import { AddressSearch, type AddressSuggestion } from "./AddressSearch";
import { CoordinateFields } from "./CoordinateFields";
import { MapBoundary } from "./MapBoundary";

const PositionMap = lazy(() => import("./PositionMap"));

interface LocationPanelProps {
  isNew: boolean;
  /** Name of the edited place (subtitle). */
  placeName?: string;
  form: LocationForm;
  onChange: (patch: Partial<LocationForm>) => void;
  onSuggestion: (s: AddressSuggestion) => void;
  onPick: (latitude: number, longitude: number) => void;
  /** Address fields filled in from the picked position (info banner). */
  filled: AddressField[];
  invalid: boolean;
  /** Typed coordinates that are not numbers (shown in the summary after a refused save). */
  coordinateErrors: ErrorSummaryItem[];
  onCoordinateErrors: (errors: ErrorSummaryItem[]) => void;
  /** Changes whenever another place is loaded, so the typed texts of the coordinate fields reset. */
  formKey: number;
  signal: number;
  saving: boolean;
  failed: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

/** Form panel of the places page (design: SettingsPlaces right column): search, address, position. */
export function LocationPanel({
  isNew,
  placeName,
  form,
  onChange,
  onSuggestion,
  onPick,
  filled,
  invalid,
  coordinateErrors,
  onCoordinateErrors,
  formKey,
  signal,
  saving,
  failed,
  onSave,
  onCancel,
  onDelete,
  headingRef,
}: LocationPanelProps) {
  const { t } = useTranslation();
  const has = form.latitude != null && form.longitude != null;
  const fieldNames = filled.map((f) => t(`settings.places.fields.${f}`)).join(", ");
  const text = (key: "name" | "street" | "zip" | "city" | "country") => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
  });

  return (
    <section
      className="ap-panel ap-stack"
      id="place-panel"
      aria-labelledby="pl-edit-h"
      style={{ minWidth: 0 }}
    >
      <div>
        <h2 className="t-h3" id="pl-edit-h" ref={headingRef} tabIndex={-1}>
          {isNew ? t("settings.places.newTitle") : t("settings.places.editTitle")}
        </h2>
        <p className="t-sm t-muted">{isNew ? t("settings.places.newSub") : placeName}</p>
      </div>

      <form
        className="ap-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <ErrorSummary
          title={
            invalid
              ? t("settings.places.errorSummary")
              : t("settings.places.errorSummaryCoordinates")
          }
          errors={[
            ...(invalid
              ? [{ fieldId: "pl-name", message: t("settings.places.nameOrStreet") }]
              : []),
            ...coordinateErrors,
          ]}
          focusSignal={signal}
        />
        {failed && (
          <Banner tone="danger" title={t("settings.places.saveFailed.title")}>
            {t("settings.places.saveFailed.text")}
          </Banner>
        )}

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

        <div className="ap-actions">
          <Button type="submit" loading={saving}>
            {t("settings.places.save")}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </Button>
          {onDelete && (
            <Button variant="ghost-danger" icon="trash" onClick={onDelete} disabled={saving}>
              {t("settings.places.delete.action")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
