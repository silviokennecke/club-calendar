import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiFetch, apiPost, BACKEND_URL, sessionUser, type TokenResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isEmailShape } from "@/lib/email";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";
import type { IdentifyAuth } from "@/lib/opaque";
import { ssoErrorKey } from "@/lib/ssoError";
import { createSsoChallenge } from "@/lib/ssoBinding";
import {
  clearInvitationToken,
  readInvitationToken,
  type InvitationPreview,
} from "@/lib/invitations";
import { Banner, Button, ErrorSummary, Field, SsoButton, TextInput } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Collapse } from "@/components/auth/Collapse";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { LoginStep } from "@/components/auth/LoginStep";
import { SignupStep } from "@/components/auth/SignupStep";

interface SsoProvider {
  id: string;
  name: string;
  icon: string;
}

type Status = "login" | "register" | "registration_restricted";
type StepName = "email" | Status;

const EMAIL_ID = "entry-email";
const RESTRICTED_BACK_ID = "entry-restricted-back";

/**
 * /login and /signup: one email-first flow. Step 1 asks for the address (plus SSO / passkey), the API
 * decides between password sign-in, signup and "invitation only" for step 2. An invitation token
 * stashed by /invitations is previewed here so the address can be prefilled.
 */
export default function SignInPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // null = untouched, so an invitation can prefill without an effect
  const [typed, setTyped] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: Status;
    email: string;
    auth?: IdentifyAuth;
  } | null>(null);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [submits, setSubmits] = useState(0);
  const [identifying, setIdentifying] = useState(false);
  const [identifyProblem, setIdentifyProblem] = useState<string | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [passkeyProblem, setPasskeyProblem] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  // The OAuth callback redirects here with ?error=... when the provider sign-in failed.
  const [ssoError, setSsoError] = useState<string | null>(searchParams.get("error"));
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [token] = useState(readInvitationToken);
  const leftEmailStep = useRef(false);

  const preview = useQuery({
    queryKey: ["invitation-preview", token],
    queryFn: () => apiPost<InvitationPreview>("/api/invitations/preview", { token }),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
  });
  const inviteDead = preview.isError && (preview.error as { status?: number }).status === 404;
  useEffect(() => {
    if (inviteDead) clearInvitationToken();
  }, [inviteDead]);

  const email = typed ?? preview.data?.email ?? "";
  // Step 2 is a history entry (state flag), so the browser Back/Forward buttons move between the steps.
  const inStepTwo = (location.state as { authStep?: boolean } | null)?.authStep === true;
  const step: StepName = inStepTwo && result ? result.status : "email";

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/auth/providers`)
      .then((r) => r.json())
      .then((list) => setProviders(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (step !== "email") leftEmailStep.current = true;
    else if (leftEmailStep.current) document.getElementById(EMAIL_ID)?.focus();
  }, [step]);

  function back() {
    if (inStepTwo) navigate(-1);
    else navigate({ pathname: location.pathname, search: location.search }, { replace: true });
  }

  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    setSubmits((n) => n + 1);
    setSsoError(null);
    setPasskeyProblem(false);
    setIdentifyProblem(null);
    const trimmed = email.trim();
    const invalid = !trimmed
      ? t("auth.login.emailMissing")
      : !isEmailShape(trimmed)
        ? t("auth.emailInvalid")
        : undefined;
    setEmailError(invalid);
    if (invalid) return;

    setIdentifying(true);
    try {
      const res = await apiPost<{ email: string; status: Status; auth?: IdentifyAuth }>(
        "/api/auth/identify",
        {
          email: trimmed,
        },
      );
      setTyped(res.email);
      setResult({ status: res.status, email: res.email, auth: res.auth });
      navigate(
        { pathname: location.pathname, search: location.search },
        { state: { authStep: true } },
      );
    } catch (err: unknown) {
      setIdentifyProblem(isRateLimited(err) ? rateLimitText(t, err) : t("auth.entry.failed"));
      setProblemKey((k) => k + 1);
    } finally {
      setIdentifying(false);
    }
  }

  // The login code is bound to this tab: the challenge goes to the start route, the verifier stays here.
  async function startSso(event: MouseEvent<HTMLAnchorElement>, provider: string) {
    event.preventDefault();
    setSsoError(null);
    try {
      const challenge = await createSsoChallenge();
      window.location.assign(
        `${BACKEND_URL}/api/auth/oauth/${provider}?${new URLSearchParams({ code_challenge: challenge })}`,
      );
    } catch {
      setSsoError("oauth_failed");
    }
  }

  async function handlePasskey() {
    setSsoError(null);
    setPasskeyProblem(false);
    setIdentifyProblem(null);
    setPasskeyLoading(true);
    try {
      const { startAuthentication } = await import("@simplewebauthn/browser");
      const optRes = await apiFetch("/api/auth/webauthn/authenticate/options");
      const { options, challengeToken } = (await optRes.json()) as {
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
        challengeToken: string;
      };
      const response = await startAuthentication({ optionsJSON: options });
      const verifyRes = await apiFetch("/api/auth/webauthn/authenticate/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, response }),
      });
      if (!verifyRes.ok) {
        setPasskeyProblem(true);
        setProblemKey((k) => k + 1);
        return;
      }
      const data = (await verifyRes.json()) as TokenResponse;
      login(data.access_token, data.refresh_token, sessionUser(data));
      navigate(data.emailVerificationRequired ? "/verify-email" : "/clubs");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("cancel") && !msg.includes("abort")) {
        setPasskeyProblem(true);
        setProblemKey((k) => k + 1);
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  const titleKey: Record<StepName, string> = {
    email: "auth.entry.title",
    login: "auth.signIn",
    register: "auth.createAccount",
    registration_restricted: "auth.entry.restrictedTitle",
  };
  const introKey: Record<StepName, string> = {
    email: "auth.entry.intro",
    login: "auth.entry.loginIntro",
    register: "auth.entry.registerIntro",
    registration_restricted: "auth.entry.restrictedIntro",
  };
  const panel = result;

  // Escape returns to the first step (not while a nested dialog, e.g. a legal document, handles it)
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || step === "email" || e.defaultPrevented) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    back();
  }

  return (
    <AuthLayout title={t(titleKey[step])} intro={t(introKey[step])}>
      <p className="sr-only" role="status" aria-live="polite">
        {t(`auth.entry.announce.${step}`)}
      </p>
      <Collapse open={preview.isSuccess || inviteDead}>
        {preview.isSuccess ? (
          <Banner tone="info" icon="mail" title={t("auth.entry.invitedTitle")}>
            {preview.data.invitedByName
              ? t("auth.entry.invitedBy", {
                  club: preview.data.clubName,
                  name: preview.data.invitedByName,
                })
              : t("auth.entry.invited", { club: preview.data.clubName })}
          </Banner>
        ) : (
          <Banner tone="warning" title={t("auth.entry.inviteDeadTitle")}>
            {t("auth.entry.inviteDeadText")}
          </Banner>
        )}
      </Collapse>

      <div className="ap-flow" onKeyDown={onKeyDown}>
        <Collapse open={step === "email"}>
          <div className="ap-stack">
            {passkeyProblem && (
              <FocusBanner key={problemKey} tone="danger" title={t("auth.login.passkeyErrorTitle")}>
                {t("auth.login.passkeyErrorText")}
              </FocusBanner>
            )}
            {ssoError !== null && (
              <FocusBanner tone="danger" title={t("auth.login.ssoErrorTitle")}>
                {t(ssoErrorKey(ssoError))}
              </FocusBanner>
            )}
            {identifyProblem && (
              <FocusBanner key={problemKey} tone="danger" title={t("auth.entry.failedTitle")}>
                {identifyProblem}
              </FocusBanner>
            )}
            <form
              className="ap-form"
              aria-label={t("auth.entry.formLabel")}
              onSubmit={handleContinue}
              noValidate
            >
              <ErrorSummary
                title={t("auth.entry.errorTitle")}
                focusSignal={submits}
                errors={emailError ? [{ fieldId: EMAIL_ID, message: emailError }] : []}
              />
              <Field id={EMAIL_ID} label={t("auth.email")} required error={emailError}>
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setEmailError(undefined);
                  }}
                  autoComplete="username webauthn"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>
              <Button
                type="submit"
                block
                loading={identifying}
                loadingLabel={t("auth.entry.checking")}
              >
                {t("auth.entry.continue")}
              </Button>
            </form>
            <div className="ap-divider-text">
              <span>{t("auth.or")}</span>
            </div>
            <div className="ap-stack ap-stack--sm">
              <Button
                variant="sso"
                icon="key"
                loading={passkeyLoading}
                loadingLabel={t("auth.passkeyWaiting")}
                onClick={handlePasskey}
              >
                {t("auth.passkey")}
              </Button>
              {providers.map((provider) => (
                <SsoButton
                  key={provider.id}
                  provider={provider.id}
                  name={provider.name}
                  href={`${BACKEND_URL}/api/auth/oauth/${provider.id}`}
                  onClick={(event) => startSso(event, provider.id)}
                />
              ))}
            </div>
          </div>
        </Collapse>

        <Collapse open={step !== "email"}>
          {panel?.status === "login" && (
            <LoginStep key={panel.email} email={panel.email} auth={panel.auth} onBack={back} />
          )}
          {panel?.status === "register" && (
            <SignupStep key={panel.email} email={panel.email} onBack={back} />
          )}
          {panel?.status === "registration_restricted" && (
            <RestrictedStep email={panel.email} onBack={back} />
          )}
        </Collapse>
      </div>
    </AuthLayout>
  );
}

function RestrictedStep({ email, onBack }: { email: string; onBack: () => void }) {
  const { t } = useTranslation();
  useEffect(() => {
    document.getElementById(RESTRICTED_BACK_ID)?.focus();
  }, []);
  return (
    <div className="ap-stack">
      <Banner tone="info" title={t("auth.entry.restrictedBannerTitle")}>
        {t("auth.entry.restrictedText", { email })}
      </Banner>
      <Button id={RESTRICTED_BACK_ID} variant="secondary" block icon="arrow-left" onClick={onBack}>
        {t("auth.entry.back")}
      </Button>
    </div>
  );
}
