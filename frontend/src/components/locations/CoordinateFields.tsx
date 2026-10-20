import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Disclosure, Field, TextInput, type ErrorSummaryItem } from "@/components/ui/shared";
import { parseCoordinate } from "@/lib/settings";

function text(value: number | null) {
  return value == null ? "" : String(value);
}

function CoordinateInput({
  id,
  label,
  value,
  limit,
  onChange,
  onInvalidChange,
  disabled,
}: {
  id: string;
  label: string;
  value: number | null;
  limit: 90 | 180;
  onChange: (value: number | null) => void;
  /** Whether the typed text is not a valid coordinate (the value above is null then, so the text would be lost). */
  onInvalidChange: (invalid: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(text(value));
  const [seen, setSeen] = useState(value);
  // The value changed from outside (map click, suggestion): show it, unless the text already means it.
  if (value !== seen) {
    setSeen(value);
    if (parseCoordinate(raw, limit) !== value) setRaw(text(value));
  }
  const invalid = raw.trim() !== "" && parseCoordinate(raw, limit) === null;
  useEffect(() => onInvalidChange(invalid), [invalid, onInvalidChange]);
  return (
    <Field
      id={id}
      label={label}
      error={invalid ? t("settings.places.coordinates.invalid", { limit }) : undefined}
    >
      <TextInput
        inputMode="decimal"
        autoComplete="off"
        value={raw}
        disabled={disabled}
        onChange={(e) => {
          setRaw(e.target.value);
          const parsed = parseCoordinate(e.target.value, limit);
          setSeen(parsed);
          onChange(parsed);
        }}
      />
    </Field>
  );
}

/** Latitude/longitude by keyboard: the alternative to clicking or dragging on the map. */
export function CoordinateFields({
  latitude,
  longitude,
  onChange,
  onErrorsChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number | null, longitude: number | null) => void;
  /**
   * The fields that currently hold text that is not a coordinate, as error summary entries. Text like
   * that is not part of the form value (it parses to null), so the page must know about it to block saving.
   */
  onErrorsChange?: (errors: ErrorSummaryItem[]) => void;
}) {
  const { t } = useTranslation();
  const [bad, setBad] = useState({ lat: false, lng: false });
  useEffect(() => {
    const message = (label: string, limit: number) =>
      t("settings.places.coordinates.summaryItem", {
        label,
        message: t("settings.places.coordinates.invalid", { limit }),
      });
    onErrorsChange?.([
      ...(bad.lat
        ? [{ fieldId: "pl-lat", message: message(t("settings.places.coordinates.latitude"), 90) }]
        : []),
      ...(bad.lng
        ? [{ fieldId: "pl-lng", message: message(t("settings.places.coordinates.longitude"), 180) }]
        : []),
    ]);
  }, [bad, onErrorsChange, t]);
  // Opens when a position appears (map click, suggestion, saved place). It never closes by itself:
  // typing something that is not a number empties the value, which must not collapse the fields.
  const details = useRef<HTMLDetailsElement>(null);
  const hasPosition = latitude != null || longitude != null;
  useEffect(() => {
    if (hasPosition && details.current) details.current.open = true;
  }, [hasPosition]);
  const setLat = useCallback(
    (lat: boolean) => setBad((b) => (b.lat === lat ? b : { ...b, lat })),
    [],
  );
  const setLng = useCallback(
    (lng: boolean) => setBad((b) => (b.lng === lng ? b : { ...b, lng })),
    [],
  );
  return (
    <Disclosure ref={details} title={t("settings.places.coordinates.summary")}>
      <div className="ap-stack ap-stack--sm">
        <p className="t-sm t-muted">{t("settings.places.coordinates.hint")}</p>
        <div className="ap-inputrow">
          <CoordinateInput
            id="pl-lat"
            label={t("settings.places.coordinates.latitude")}
            value={latitude}
            limit={90}
            onChange={(v) => onChange(v, longitude)}
            onInvalidChange={setLat}
          />
          <CoordinateInput
            id="pl-lng"
            label={t("settings.places.coordinates.longitude")}
            value={longitude}
            limit={180}
            onChange={(v) => onChange(latitude, v)}
            onInvalidChange={setLng}
          />
        </div>
      </div>
    </Disclosure>
  );
}
