import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "@/lib/api";
import type { Calendar } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check } from "lucide-react";
import { FormField } from "@/components/ui/shared";
import { useTranslation } from "react-i18next";

export default function CalendarSettingsPage() {
  const { t } = useTranslation();
  const { clubId, calendarId } = useParams<{ clubId: string; calendarId: string }>();

  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("");
  const [tzSearch, setTzSearch] = useState("");
  const [showTzDropdown, setShowTzDropdown] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: calendar } = useQuery({
    queryKey: ["calendar", calendarId],
    queryFn: () => apiGet<Calendar>(`/api/clubs/${clubId}/calendars/${calendarId}`),
  });
  useEffect(() => {
    if (calendar) {
      setName(calendar.name);
      setTimezone(calendar.timezone ?? "");
    }
  }, [calendar]);

  async function handleSave() {
    setSaving(true);
    try {
      await apiPatch(`/api/clubs/${clubId}/calendars/${calendarId}`, {
        name,
        timezone: timezone || null,
      });
      qc.invalidateQueries({ queryKey: ["calendar", calendarId] });
      qc.invalidateQueries({ queryKey: ["calendars", clubId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-lg p-6">
      <h2 className="mb-6 text-base font-semibold text-slate-900">{t("settings.title")}</h2>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <FormField label={t("settings.calendarName")}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
        </FormField>

        <FormField
          label={
            <>
              {t("settings.timezone")}{" "}
              <span className="font-normal text-slate-400">
                ({t("settings.overridesClubDefault")})
              </span>
            </>
          }
        >
          <div className="relative">
            <Input
              value={tzSearch || timezone}
              onChange={(e) => {
                setTzSearch(e.target.value);
                setShowTzDropdown(true);
              }}
              onFocus={() => {
                setTzSearch("");
                setShowTzDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowTzDropdown(false), 150)}
              placeholder="e.g. Europe/Berlin"
              className="text-sm"
            />
            {showTzDropdown && (
              <div className="absolute top-full right-0 left-0 z-20 mt-0.5 max-h-52 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg">
                <button
                  type="button"
                  onMouseDown={() => {
                    setTimezone("");
                    setTzSearch("");
                    setShowTzDropdown(false);
                  }}
                  className="w-full border-b border-slate-100 px-3 py-2 text-left text-xs text-slate-400 italic hover:bg-slate-50"
                >
                  — {t("settings.useClubDefault")} —
                </button>
                {(typeof Intl !== "undefined" && "supportedValuesOf" in Intl
                  ? (
                      Intl as unknown as { supportedValuesOf: (key: string) => string[] }
                    ).supportedValuesOf("timeZone")
                  : [
                      "Europe/Berlin",
                      "Europe/London",
                      "America/New_York",
                      "America/Los_Angeles",
                      "Asia/Tokyo",
                      "UTC",
                    ]
                )
                  .filter((tz) => !tzSearch || tz.toLowerCase().includes(tzSearch.toLowerCase()))
                  .slice(0, 50)
                  .map((tz) => (
                    <button
                      key={tz}
                      type="button"
                      onMouseDown={() => {
                        setTimezone(tz);
                        setTzSearch("");
                        setShowTzDropdown(false);
                      }}
                      className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 ${tz === timezone ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700"}`}
                    >
                      {tz}
                    </button>
                  ))}
              </div>
            )}
          </div>
          {timezone && (
            <p className="text-xs text-slate-400">
              {t("settings.currentTime")}{" "}
              {new Date().toLocaleTimeString("de-DE", { timeZone: timezone })}
            </p>
          )}
        </FormField>

        <Button disabled={saving || !name.trim()} onClick={handleSave} className="gap-1.5">
          {saved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              {t("settings.saved")}
            </>
          ) : (
            t("settings.save")
          )}
        </Button>
      </div>
    </div>
  );
}
