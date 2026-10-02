import { lazy, Suspense, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Chip } from "./ChipSelect";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";

const EmojiMartPanel = lazy(() => import("./EmojiMartPanel"));

/** Preset symbols (club content, not UI icons) with i18n keys for their accessible names. */
const PRESETS: ReadonlyArray<readonly [string, string]> = [
  ["🏆", "trophy"],
  ["🎯", "target"],
  ["🌳", "outdoor"],
  ["📝", "registration"],
  ["🧥", "costume"],
  ["🍰", "food"],
  ["☕", "coffee"],
  ["🎉", "party"],
  ["🔧", "workDuty"],
  ["🚗", "carpool"],
  ["♿", "accessible"],
  ["📣", "announcement"],
  ["🎵", "music"],
  ["⚽", "ball"],
  ["⭐", "star"],
  ["👥", "group"],
  ["🔒", "membersOnly"],
  ["🌧️", "weather"],
];

interface EmojiPickerProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Pick a symbol for a property: "no symbol", presets, a custom emoji typed/pasted by the user,
 * or the full emoji-mart catalogue (lazy loaded).
 */
export function EmojiPicker({ label, value, onChange, className }: EmojiPickerProps) {
  const { t, i18n } = useTranslation();
  const { resolvedTheme } = useTheme();
  const uid = useId().replace(/:/g, "");
  const inputId = `emoji-${uid}`;
  const hintId = `${inputId}-hint`;
  const panelId = `${inputId}-more`;
  const [draft, setDraft] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const isCustom = value !== "" && !PRESETS.some(([ch]) => ch === value);

  function applyDraft() {
    const d = draft.trim();
    if (d) {
      onChange(d);
      setDraft("");
    }
  }

  return (
    <fieldset className={cn("ap-fieldset", className)}>
      <legend>{label}</legend>
      <div className="ap-chips">
        <Chip pressed={value === ""} onClick={() => onChange("")}>
          {t("ui.emojiPicker.none")}
        </Chip>
        {PRESETS.map(([ch, key]) => {
          const name = t(`ui.emojiPicker.names.${key}`);
          return (
            <button
              key={ch}
              type="button"
              className="ap-chip ap-chip--emoji"
              aria-pressed={value === ch}
              aria-label={name}
              title={name}
              onClick={() => onChange(ch)}
            >
              <span aria-hidden="true">{ch}</span>
            </button>
          );
        })}
        {isCustom && (
          <button
            type="button"
            className="ap-chip ap-chip--emoji"
            aria-pressed="true"
            aria-label={t("ui.emojiPicker.custom")}
            title={t("ui.emojiPicker.custom")}
          >
            <span aria-hidden="true">{value}</span>
          </button>
        )}
      </div>
      <div className="ap-row" style={{ alignItems: "flex-end", gap: 8, marginTop: 12 }}>
        <div className="ap-stack ap-stack--sm" style={{ width: 200 }}>
          <label className="t-label" htmlFor={inputId}>
            {t("ui.emojiPicker.custom")}
          </label>
          <input
            id={inputId}
            className="cc-input"
            style={{ fontSize: 20 }}
            type="text"
            maxLength={8}
            value={draft}
            aria-describedby={hintId}
            placeholder={t("ui.emojiPicker.customPlaceholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyDraft();
              }
            }}
          />
        </div>
        <Button variant="secondary" onClick={applyDraft}>
          {t("ui.emojiPicker.apply")}
        </Button>
        <Button
          variant="ghost"
          icon="smile"
          aria-expanded={moreOpen}
          aria-controls={panelId}
          onClick={() => setMoreOpen((o) => !o)}
        >
          {t("ui.emojiPicker.more")}
        </Button>
      </div>
      <p className="t-sm t-muted" id={hintId} style={{ marginTop: 8 }}>
        {t("ui.emojiPicker.hint")}
      </p>
      {moreOpen && (
        <div id={panelId}>
          <Suspense fallback={<Skeleton style={{ height: 320, width: 352 }} />}>
            <EmojiMartPanel
              language={i18n.resolvedLanguage ?? "en"}
              theme={resolvedTheme}
              onSelect={(native) => {
                onChange(native);
                setMoreOpen(false);
              }}
            />
          </Suspense>
        </div>
      )}
    </fieldset>
  );
}
