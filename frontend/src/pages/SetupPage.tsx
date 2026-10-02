import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FullPageLoader } from "@/components/ui/shared";
import type { Club, Calendar } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, Building2, Check } from "lucide-react";
import { Field } from "@/components/ui/shared";

export default function SetupPage() {
  const { t } = useTranslation();
  const { updateUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clubIdParam = searchParams.get("clubId");

  const [step, setStep] = useState<1 | 2>(1);
  const [clubName, setClubName] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [createdClub, setCreatedClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(false);

  const { data: paramClub, isLoading: paramClubLoading } = useQuery<Club>({
    queryKey: ["club", clubIdParam],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubIdParam}`),
    enabled: !!clubIdParam,
    retry: false,
  });

  const { data: existingClubs = [], isLoading: existingClubsLoading } = useQuery<Club[]>({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
    enabled: !clubIdParam,
  });

  const detecting = clubIdParam ? paramClubLoading : existingClubsLoading;

  useEffect(() => {
    if (detecting) return;
    const club = clubIdParam ? (paramClub ?? null) : (existingClubs[0] ?? null);
    if (!club) return;
    setCreatedClub(club);
    setCalendarName(club.name + " Calendar");
    setStep(2);
  }, [detecting]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateClub() {
    if (!clubName.trim()) return;
    setLoading(true);
    try {
      const club = await apiPost<Club>("/api/clubs", {
        name: clubName.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
      });
      setCreatedClub(club);
      setCalendarName(clubName.trim() + " Calendar");
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCalendar() {
    if (!calendarName.trim() || !createdClub) return;
    setLoading(true);
    try {
      const calendar = await apiPost<Calendar>(`/api/clubs/${createdClub.id}/calendars`, {
        name: calendarName.trim(),
      });
      await updateUser({ lastClubId: createdClub.id, lastCalendarId: calendar.id });
      navigate(`/clubs/${createdClub.id}/calendars/${calendar.id}`, { replace: true });
    } finally {
      setLoading(false);
    }
  }

  if (detecting) return <FullPageLoader message={t("common.loading")} />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${step >= 1 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}
          >
            {step > 1 ? <Check className="h-4 w-4" /> : "1"}
          </div>
          <div className={`h-0.5 flex-1 ${step > 1 ? "bg-blue-600" : "bg-slate-200"}`} />
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${step >= 2 ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}
          >
            2
          </div>
        </div>

        {step === 1 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100">
              <Building2 className="h-6 w-6 text-blue-600" />
            </div>
            <h1 className="mb-1 text-xl font-bold text-slate-900">{t("setup.welcome")}</h1>
            <p className="mb-6 text-sm text-slate-500">{t("setup.setupClubFirst")}</p>
            <div className="space-y-4">
              <Field label={t("setup.clubName")}>
                <Input
                  placeholder={t("setup.clubNamePlaceholder")}
                  value={clubName}
                  onChange={(e) => setClubName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateClub()}
                  autoFocus
                />
              </Field>
              <Button
                className="w-full"
                disabled={loading || !clubName.trim()}
                onClick={handleCreateClub}
              >
                {loading ? t("setup.creating") : t("setup.createClub")}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-green-100">
              <CalendarDays className="h-6 w-6 text-green-600" />
            </div>
            <h1 className="mb-1 text-xl font-bold text-slate-900">{t("setup.createCalendar")}</h1>
            <p className="mb-6 text-sm text-slate-500">
              {t("setup.forClub", { club: createdClub?.name ?? "" })}
            </p>
            <div className="space-y-4">
              <Field label={t("setup.calendarName")}>
                <Input
                  value={calendarName}
                  onChange={(e) => setCalendarName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateCalendar()}
                  autoFocus
                />
              </Field>
              <Button
                className="w-full"
                disabled={loading || !calendarName.trim()}
                onClick={handleCreateCalendar}
              >
                {loading ? t("setup.creating") : t("setup.getStarted")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
