import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Banner, Button, ErrorSummary, type ErrorSummaryItem } from "@/components/ui/shared";
import type { AddressField, LocationForm } from "@/lib/settings";
import type { AddressSuggestion } from "./AddressSearch";
import { LocationFields } from "./LocationFields";

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

        <LocationFields
          form={form}
          onChange={onChange}
          onSuggestion={onSuggestion}
          onPick={onPick}
          filled={filled}
          invalid={invalid}
          onCoordinateErrors={onCoordinateErrors}
          formKey={formKey}
        />

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
