import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, TextInput } from "@/components/ui/shared";
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
  disabled,
}: {
  id: string;
  label: string;
  value: number | null;
  limit: 90 | 180;
  onChange: (value: number | null) => void;
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
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (latitude: number | null, longitude: number | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <details className="ap-details" open={latitude != null || undefined}>
      <summary>{t("settings.places.coordinates.summary")}</summary>
      <div className="ap-stack ap-stack--sm">
        <p className="t-sm t-muted">{t("settings.places.coordinates.hint")}</p>
        <div className="ap-inputrow">
          <CoordinateInput
            id="pl-lat"
            label={t("settings.places.coordinates.latitude")}
            value={latitude}
            limit={90}
            onChange={(v) => onChange(v, longitude)}
          />
          <CoordinateInput
            id="pl-lng"
            label={t("settings.places.coordinates.longitude")}
            value={longitude}
            limit={180}
            onChange={(v) => onChange(latitude, v)}
          />
        </div>
      </div>
    </details>
  );
}
