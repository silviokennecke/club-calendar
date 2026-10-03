import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Icon, TextInput } from "@/components/ui/shared";
import { apiFetch } from "@/lib/api";

export interface AddressSuggestion {
  label: string;
  lat: number;
  lng: number;
  street?: string | null;
  zip?: string | null;
  city?: string | null;
  country?: string | null;
}

interface AddressSearchProps {
  onPick: (suggestion: AddressSuggestion) => void;
  /** Bias the search towards this point (the location's current position). */
  proximity?: { lat: number; lng: number } | null;
  id?: string;
}

type Status = "idle" | "loading" | "done" | "limit" | "error";

/**
 * Address search with suggestions (design: SettingsPlaces "Adresse suchen"): geocoding through the
 * backend, a result list of buttons and a live message with the number of hits.
 */
export function AddressSearch({ onPick, proximity, id = "pl-search" }: AddressSearchProps) {
  const { t } = useTranslation();
  const listId = `${useId().replace(/:/g, "")}-suggestions`;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressSuggestion[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function search(q: string) {
    const term = q.trim();
    const mine = ++seq.current;
    if (term.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    try {
      const near = proximity ? `&lat=${proximity.lat}&lng=${proximity.lng}` : "";
      const res = await apiFetch(
        `/api/map/geocode/suggest?q=${encodeURIComponent(term)}${near}&limit=6`,
      );
      if (mine !== seq.current) return;
      if (res.status === 429) {
        setResults([]);
        setStatus("limit");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { suggestions: AddressSuggestion[] };
      if (mine !== seq.current) return;
      setResults(data.suggestions);
      setStatus("done");
    } catch {
      if (mine !== seq.current) return;
      setResults([]);
      setStatus("error");
    }
  }

  function onChange(value: string) {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(value), 300);
  }

  function pick(s: AddressSuggestion) {
    seq.current++;
    if (timer.current) clearTimeout(timer.current);
    setQuery(s.label);
    setResults([]);
    setStatus("idle");
    onPick(s);
  }

  const message =
    status === "limit"
      ? t("settings.places.search.limit")
      : status === "error"
        ? t("settings.places.search.error")
        : status === "done" && results.length === 0
          ? t("settings.places.search.none")
          : null;

  return (
    <div className="ap-stack ap-stack--sm">
      <Field
        id={id}
        label={t("settings.places.search.label")}
        hint={t("settings.places.search.hint")}
      >
        <TextInput
          type="search"
          autoComplete="off"
          value={query}
          placeholder={t("settings.places.search.placeholder")}
          aria-controls={results.length > 0 ? listId : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (timer.current) clearTimeout(timer.current);
              void search(query);
            } else if (e.key === "Escape" && results.length > 0) {
              e.preventDefault();
              e.stopPropagation();
              setResults([]);
              setStatus("idle");
            }
          }}
        />
      </Field>
      <p className="ap-sr" role="status">
        {status === "loading"
          ? t("settings.places.search.loading")
          : status === "done" && results.length > 0
            ? t("settings.places.search.found", { count: results.length })
            : ""}
      </p>
      {message && (
        <p
          className="t-sm"
          role="status"
          style={{ color: status === "done" ? undefined : "var(--danger)" }}
        >
          {message}
        </p>
      )}
      {results.length > 0 && (
        <ul
          id={listId}
          className="ap-panel ap-panel--flush ap-list ap-suggest"
          aria-label={t("settings.places.search.results")}
        >
          {results.map((s, i) => (
            <li key={`${s.label}-${i}`}>
              <button type="button" onClick={() => pick(s)}>
                <Icon glyph="map-pin" size={18} />
                <span className="ap-grow">{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
