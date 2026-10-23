import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Location } from "@/lib/types";
import { formatAddress } from "@/lib/types";
import { locationName } from "@/lib/events";
import { rankByRelevance } from "@/lib/fuzzySearch";
import { AutocompleteInput, Field, Icon, toast } from "@/components/ui/shared";
import { LocationCreateDialog } from "./LocationCreateDialog";
import { LocationImage } from "./LocationImage";

const MAX_LOCATIONS = 8;
const CREATE_ID = "__create__";

type Option = (Location & { create?: false }) | { id: typeof CREATE_ID; create: true };

interface LocationSectionProps {
  locations: Location[];
  value: string;
  onChange: (locationId: string) => void;
  onCreate: (payload: object) => Promise<Location>;
  readOnly?: boolean;
}

/**
 * "Ort" section of the event form: autocomplete over the club's locations whose last suggestion
 * always creates a new one (dialog above the form), address and the static map image of the
 * selected location. The position is not editable here.
 */
export function LocationSection({
  locations,
  value,
  onChange,
  onCreate,
  readOnly,
}: LocationSectionProps) {
  const { t } = useTranslation();
  const selected = locations.find((l) => l.id === value);
  const [text, setText] = useState(selected ? locationName(selected) : "");
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const hasPosition = selected?.latitude != null && selected?.longitude != null;

  useEffect(() => {
    if (selected) setText(locationName(selected));
  }, [selected]);

  function search(query: string): Option[] {
    const q = query.trim();
    const hits = q
      ? rankByRelevance(locations, q, ["name", "street", "city"])
      : [...locations].sort((a, b) => locationName(a).localeCompare(locationName(b)));
    return [...hits.slice(0, MAX_LOCATIONS), { id: CREATE_ID, create: true }];
  }

  function created(location: Location) {
    onChange(location.id);
    setText(locationName(location));
    setCreatingName(null);
  }

  return (
    <div className="ap-cols-2" style={{ alignItems: "start" }}>
      <div className="ap-stack">
        <Field id="ev-place" label={t("events.form.place.label")} optional>
          <AutocompleteInput<Option>
            value={text}
            minChars={0}
            maxResults={MAX_LOCATIONS + 1}
            placeholder={t("events.form.place.placeholder")}
            readOnly={readOnly}
            onSearch={search}
            getLabel={(o) => (o.create ? textRef.current : locationName(o))}
            renderItem={(o) =>
              o.create ? (
                <span>
                  <Icon glyph="plus" size={14} /> {t("events.form.place.create")}
                </span>
              ) : (
                <>
                  <span>{locationName(o)}</span>
                  {formatAddress(o) && o.name && (
                    <span className="text-ink-muted block">{formatAddress(o)}</span>
                  )}
                </>
              )
            }
            onValueChange={(v) => {
              setText(v);
              if (!v.trim() || (selected && v !== locationName(selected))) onChange("");
            }}
            onSelect={(o) => {
              if (o.create) setCreatingName(textRef.current.trim());
              else onChange(o.id);
            }}
            onBlur={() => {
              if (!value) setText("");
            }}
          />
        </Field>
        {selected && (
          <p className="t-sm t-muted">
            {formatAddress(selected) || t("events.form.place.noAddress")}
          </p>
        )}
      </div>
      <div className="ap-stack">
        {selected && hasPosition ? (
          <LocationImage
            key={selected.id}
            location={selected}
            label={t("events.form.place.map", { name: locationName(selected) })}
          />
        ) : selected ? (
          <p className="t-sm t-muted">{t("events.form.place.noPosition")}</p>
        ) : (
          <p className="ap-panel ap-panel--sunken t-sm t-muted">{t("events.form.place.empty")}</p>
        )}
      </div>
      {creatingName !== null && (
        <LocationCreateDialog
          initialName={creatingName}
          onCreate={async (payload) => {
            try {
              return await onCreate(payload);
            } catch (e) {
              toast.error(t("events.form.place.createFailed"));
              throw e;
            }
          }}
          onCreated={created}
          onClose={() => setCreatingName(null)}
        />
      )}
    </div>
  );
}
