import { useTranslation } from "react-i18next";
import { isValidIso, weekdayNames } from "@/lib/calendar";
import type { SeriesFormRule, SeriesFrequency, SeriesNth } from "@/lib/events";
import { Field, NativeSelect, TextInput } from "@/components/ui/shared";
import { useLocale } from "@/components/calendar/useLocale";

const RHYTHMS: SeriesFrequency[] = ["weekly", "biweekly", "monthly"];
const NTHS: SeriesNth[] = [1, 2, 3, 4, 5];
/** Monday first, Sunday last (design order). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

interface SeriesRuleFieldsProps {
  value: SeriesFormRule;
  onChange: (next: SeriesFormRule) => void;
  /** Prefix of the field ids (several forms may exist on one page). */
  idPrefix: string;
  /** Hint below "Feiertage auslassen" (counter of the server preview). */
  skipHint: string;
  /** Extra hint below "Bis" (e.g. a series that ended by count so far). */
  toHint?: string;
}

/**
 * The fields of a series rule (design: EventSeries, step "Serienregel"): rhythm, n-th weekday
 * (monthly), weekday, "Von" / "Bis" and "Feiertage auslassen". Used by "Termin aus Vorlage" and by
 * "Reihe ändern". The dates themselves always come from the server preview.
 */
export function SeriesRuleFields({
  value,
  onChange,
  idPrefix,
  skipHint,
  toHint,
}: SeriesRuleFieldsProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const names = weekdayNames(locale, 0, "long");
  const set = <K extends keyof SeriesFormRule>(key: K, v: SeriesFormRule[K]) =>
    onChange({ ...value, [key]: v });
  const rangeError = isValidIso(value.from) && isValidIso(value.to) && value.to < value.from;

  return (
    <>
      <fieldset className="ap-fieldset">
        <legend>{t("events.series.rhythm")}</legend>
        <div
          className="ap-seg"
          role="group"
          aria-label={t("events.series.rhythm")}
          style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
        >
          {RHYTHMS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={value.rhythm === r}
              onClick={() => set("rhythm", r)}
            >
              {t(`events.series.rhythms.${r}`)}
            </button>
          ))}
        </div>
      </fieldset>
      {value.rhythm === "monthly" && (
        <fieldset className="ap-fieldset">
          <legend>{t("events.series.nthLegend")}</legend>
          <div
            className="ap-seg"
            role="group"
            aria-label={t("events.series.nthLegend")}
            style={{ alignSelf: "flex-start", flexWrap: "wrap" }}
          >
            {NTHS.map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={value.nth === x}
                onClick={() => set("nth", x)}
              >
                {t(`events.series.nth.${x}`)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <Field id={`${idPrefix}-wd`} label={t("events.series.weekday")}>
        <NativeSelect
          value={value.weekday}
          onChange={(e) => set("weekday", Number(e.target.value))}
        >
          {WEEKDAY_ORDER.map((d) => (
            <option key={d} value={d}>
              {names[d]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="ap-inputrow">
        <Field id={`${idPrefix}-from`} label={t("events.series.from")} required>
          <TextInput
            autoComplete="off"
            type="date"
            value={value.from}
            onChange={(e) => set("from", e.target.value)}
          />
        </Field>
        <Field
          id={`${idPrefix}-to`}
          label={t("events.series.to")}
          required
          hint={toHint}
          error={rangeError ? t("events.series.rangeInvalid") : undefined}
        >
          <TextInput
            autoComplete="off"
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => set("to", e.target.value)}
          />
        </Field>
      </div>
      <div>
        <label className="ap-check">
          <input
            type="checkbox"
            checked={value.skipHolidays}
            aria-describedby={`${idPrefix}-skip-hint`}
            onChange={(e) => set("skipHolidays", e.target.checked)}
          />
          <span>
            {t("events.series.skipHolidays")}
            <small id={`${idPrefix}-skip-hint`}>{skipHint}</small>
          </span>
        </label>
      </div>
    </>
  );
}
