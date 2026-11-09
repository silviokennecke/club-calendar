import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useClubCreationAllowed } from "@/lib/registration";
import type { Club, Calendar } from "@/lib/types";
import {
  Banner,
  Button,
  EmptyState,
  ErrorSummary,
  Field,
  FullPageLoader,
  Icon,
  LinkButton,
  Stepper,
  TextInput,
} from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";

type Step = 1 | 2;

const CLUB_NAME_ID = "setup-club-name";
const CALENDAR_NAME_ID = "setup-calendar-name";

/**
 * Onboarding (design: Onboarding / OnboardingCalendar): step 1 creates a club, step 2 its first
 * calendar. Always starts at step 1 (new club); `?clubId=` continues at step 2 for that club (a club
 * without calendar). `?new=1` is the same as no parameter.
 */
export default function SetupPage() {
  const { t } = useTranslation();
  const { updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const clubIdParam = searchParams.get("clubId");

  const { allowed: creationAllowed, loading: registrationLoading } = useClubCreationAllowed();
  const [step, setStep] = useState<Step>(1);
  const [clubName, setClubName] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [createdClub, setCreatedClub] = useState<Club | null>(null);
  // True when the club was created in this session (the user can go back and rename it).
  const [clubIsNew, setClubIsNew] = useState(false);
  const [clubError, setClubError] = useState(false);
  const [calendarError, setCalendarError] = useState(false);
  // Bumped on every failed submit so the ErrorSummary takes focus.
  const [signal, setSignal] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepChanged = useRef(false);

  const { data: paramClub, isLoading: paramClubLoading } = useQuery<Club>({
    queryKey: ["club", clubIdParam],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubIdParam}`),
    enabled: !!clubIdParam,
    retry: false,
  });

  // Without `?clubId=` the page always starts at step 1 (a new club), also for users with clubs.
  const detecting = clubIdParam ? paramClubLoading : false;

  const suggestion = () => t("setup.calendarSuggestion", { year: new Date().getFullYear() });

  useEffect(() => {
    if (detecting) return;
    const club = clubIdParam ? (paramClub ?? null) : null;
    if (!club) return;
    setCreatedClub(club);
    setCalendarName(suggestion());
    setStep(2);
  }, [detecting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Moving between steps replaces the whole form: move focus to the new heading so screen reader
  // and keyboard users land at the top of the new step (not on the first load).
  useEffect(() => {
    if (!stepChanged.current) {
      stepChanged.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  async function handleCreateClub(e: React.FormEvent) {
    e.preventDefault();
    const name = clubName.trim();
    if (!name) {
      setClubError(true);
      setSignal((n) => n + 1);
      return;
    }
    setFailed(false);
    setLoading(true);
    try {
      let club = createdClub;
      if (club && clubIsNew) {
        // Back from step 2: rename instead of creating a second club.
        if (club.name !== name) club = await apiPatch<Club>(`/api/clubs/${club.id}`, { name });
      } else {
        // Browsers without a configured zone report "Etc/Unknown", which the backend rejects.
        const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
        club = await apiPost<Club>("/api/clubs", {
          name,
          timezone: detected && detected !== "Etc/Unknown" ? detected : "Europe/Berlin",
        });
        setClubIsNew(true);
        setCalendarName(suggestion());
      }
      setCreatedClub(club);
      void queryClient.invalidateQueries({ queryKey: ["clubs"] });
      setStep(2);
    } catch (err) {
      if ((err as { code?: string })?.code !== "club_creation_restricted") setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCalendar(e: React.FormEvent) {
    e.preventDefault();
    const name = calendarName.trim();
    if (!name) {
      setCalendarError(true);
      setSignal((n) => n + 1);
      return;
    }
    if (!createdClub) return;
    setFailed(false);
    setLoading(true);
    try {
      const calendar = await apiPost<Calendar>(`/api/clubs/${createdClub.id}/calendars`, { name });
      await updateUser({ lastClubId: createdClub.id, lastCalendarId: calendar.id });
      navigate(`/clubs/${createdClub.id}/calendars/${calendar.id}`, { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  if (detecting || (!clubIdParam && registrationLoading))
    return <FullPageLoader message={t("common.loading")} />;

  if (!clubIdParam && !creationAllowed) {
    return (
      <AuthLayout title={t("setup.restrictedTitle")}>
        <EmptyState
          icon="building"
          title={t("setup.restrictedTitle")}
          text={t("setup.restrictedText")}
          actions={
            <LinkButton to="/clubs?select=1" variant="secondary">
              {t("setup.restrictedBack")}
            </LinkButton>
          }
        />
      </AuthLayout>
    );
  }

  const signOut = (
    <button type="button" className="ap-link min-h-tap" onClick={logout}>
      {t("auth.signOut")}
    </button>
  );

  // Newly registered users may postpone the club (invitations wait on the club picker). Not offered when
  // the user deliberately asked for another club (?new=1).
  const skip = !searchParams.has("new") && (
    <Link to="/clubs?select=1" className="ap-link min-h-tap inline-flex items-center">
      {t("setup.skip")}
    </Link>
  );

  const errorBanner = failed && (
    <Banner tone="danger" title={t("setup.errorTitle")}>
      {t("setup.errorText")}
    </Banner>
  );

  return (
    <AuthLayout
      wide
      headingRef={headingRef}
      top={<Stepper steps={[t("setup.stepClub"), t("setup.stepCalendar")]} current={step} />}
      title={step === 1 ? t("setup.welcome") : t("setup.createCalendar")}
      intro={step === 1 ? t("setup.setupClubFirst") : undefined}
      footer={
        step === 1 ? (
          <span className="ap-row ap-spread">
            {skip}
            {signOut}
          </span>
        ) : undefined
      }
    >
      {step === 1 && (
        <form
          className="ap-form"
          aria-label={t("setup.clubFormLabel")}
          onSubmit={handleCreateClub}
          noValidate
        >
          {errorBanner}
          <ErrorSummary
            title={t("setup.clubErrorSummary")}
            errors={clubError ? [{ fieldId: CLUB_NAME_ID, message: t("setup.clubNameError") }] : []}
            focusSignal={signal}
          />
          <Field
            id={CLUB_NAME_ID}
            label={t("setup.clubName")}
            required
            hint={t("setup.clubNameHint")}
            error={clubError ? t("setup.clubNameError") : undefined}
          >
            <TextInput
              placeholder={t("setup.clubNamePlaceholder")}
              value={clubName}
              autoComplete="organization"
              onChange={(e) => {
                setClubName(e.target.value);
                if (e.target.value.trim()) setClubError(false);
              }}
            />
          </Field>
          <Button type="submit" block loading={loading} loadingLabel={t("setup.creating")}>
            {t("setup.createClub")}
          </Button>
        </form>
      )}

      {step === 2 && (
        <>
          <Banner tone="success">
            {t("setup.clubCreated", { club: createdClub?.name ?? "" })}
          </Banner>
          <form
            className="ap-form"
            aria-label={t("setup.calendarFormLabel")}
            onSubmit={handleCreateCalendar}
            noValidate
          >
            {errorBanner}
            <ErrorSummary
              title={t("setup.calendarErrorSummary")}
              errors={
                calendarError
                  ? [{ fieldId: CALENDAR_NAME_ID, message: t("setup.calendarNameError") }]
                  : []
              }
              focusSignal={signal}
            />
            <Field
              id={CALENDAR_NAME_ID}
              label={t("setup.calendarName")}
              required
              hint={t("setup.calendarNameHint")}
              error={calendarError ? t("setup.calendarNameError") : undefined}
            >
              <TextInput
                autoComplete="off"
                value={calendarName}
                onChange={(e) => {
                  setCalendarName(e.target.value);
                  if (e.target.value.trim()) setCalendarError(false);
                }}
              />
            </Field>
            <div className="ap-panel ap-panel--sunken ap-row ap-row--nowrap items-start p-4">
              <span className="flex flex-none pt-0.5" aria-hidden="true">
                <Icon glyph="clock" size={20} />
              </span>
              <div className="ap-stack ap-stack--sm">
                <p className="t-label">
                  {clubIsNew
                    ? t("setup.timezoneDetected", { timezone: createdClub?.timezone ?? "" })
                    : t("setup.timezoneClub", { timezone: createdClub?.timezone ?? "" })}
                </p>
                <p className="t-sm t-muted">{t("setup.timezoneHint")}</p>
              </div>
            </div>
            <div className="ap-actions ap-actions--split">
              {clubIsNew ? (
                <Button
                  variant="secondary"
                  icon="arrow-left"
                  disabled={loading}
                  onClick={() => {
                    setFailed(false);
                    setStep(1);
                  }}
                >
                  {t("setup.back")}
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" loading={loading} loadingLabel={t("setup.creating")}>
                {t("setup.getStarted")}
              </Button>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
