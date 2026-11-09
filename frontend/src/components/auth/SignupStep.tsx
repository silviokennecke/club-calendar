import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost, sessionUser, type TokenResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import {
  consentCheckboxId,
  legalKeys,
  useLegalOverview,
  type LegalOverview,
  type LegalType,
} from "@/lib/legal";
import {
  opaqueFailureKind,
  opaqueSignup,
  prefetchOpaque,
  signupProtocol,
  type IdentifyAuth,
} from "@/lib/opaque";
import { isRateLimited, rateLimitText } from "@/lib/rateLimit";
import { passwordProblem } from "@/lib/password";
import { useFieldTouch } from "@/lib/useFieldTouch";
import i18n from "@/lib/i18n";
import { Button, ErrorSummary, Field, PasswordField, TextInput } from "@/components/ui/shared";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { ConsentCheckboxes } from "@/components/legal/ConsentCheckboxes";

interface FieldErrors {
  name?: string;
  password?: string;
  confirm?: string;
}

type Problem =
  "exists" | "generic" | "consent" | "restricted" | "rate" | "unsupported" | "unavailable";

/** Documents the user has to accept at signup (when the operator provides them). */
const CONSENT_TYPES: readonly LegalType[] = ["privacy", "terms"];

const IDS = {
  name: "signup-name",
  password: "signup-password",
  confirm: "signup-confirm",
} as const;

/** Step 2 for a new address: the signup form (address fixed). */
export function SignupStep({
  email,
  auth,
  onBack,
}: {
  email: string;
  /** `auth` hint of identify: `opaque` signs up through the OPAQUE register flow. */
  auth?: IdentifyAuth;
  onBack: () => void;
}) {
  const protocol = signupProtocol(auth);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useFieldTouch<keyof FieldErrors>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const legal = useLegalOverview();
  const [rateText, setRateText] = useState("");
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [consentErrors, setConsentErrors] = useState<Record<string, string | undefined>>({});
  const consentItems = useMemo(
    () =>
      CONSENT_TYPES.flatMap((type) => {
        const doc = legal.data?.[type];
        return doc ? [{ type, id: doc.id, url: doc.url }] : [];
      }),
    [legal.data],
  );

  useEffect(() => {
    document.getElementById(IDS.name)?.focus();
  }, []);

  function fail(next: Problem) {
    setProblem(next);
    setProblemKey((k) => k + 1);
  }

  const found: FieldErrors = {};
  if (!name.trim()) found.name = t("auth.register.nameMissing");
  const pwProblem = passwordProblem(password);
  if (pwProblem === "missing") found.password = t("auth.register.passwordMissing");
  else if (pwProblem === "short") found.password = t("auth.register.passwordShortField");
  else if (pwProblem === "long") found.password = t("auth.register.passwordLongField");
  if (password && confirm !== password) found.confirm = t("auth.register.confirmMismatchField");

  const errors: FieldErrors = {};
  for (const k of ["name", "password", "confirm"] as const) {
    errors[k] = form.shown(k) ? found[k] : undefined;
  }

  const summary: { fieldId: string; message: string }[] = [
    ...(["name", "password", "confirm"] as const).flatMap((k) =>
      errors[k] ? [{ fieldId: IDS[k], message: errors[k] }] : [],
    ),
    ...consentItems.flatMap((i) => {
      const message = consentErrors[i.id];
      return message ? [{ fieldId: consentCheckboxId("signup-consent", i.type), message }] : [];
    }),
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    setConsentErrors({});
    form.submit();

    const missing: Record<string, string> = {};
    for (const item of consentItems) {
      if (!accepted.has(item.id)) missing[item.id] = t(`consent.required.${item.type}`);
    }

    if (Object.keys(found).length > 0 || Object.keys(missing).length > 0) {
      setConsentErrors(missing);
      return;
    }

    setLoading(true);
    try {
      const language = i18n.resolvedLanguage ?? "en";
      const acceptedDocuments = consentItems.map((i) => i.id);
      const res =
        protocol === "opaque"
          ? await opaqueSignup(email, password, { name, language, acceptedDocuments })
          : await apiPost<TokenResponse>("/api/auth/register", {
              name,
              email,
              password,
              language,
              acceptedDocuments,
            });
      // restricted session: the address is confirmed with the code from the e-mail
      login(res.access_token, res.refresh_token, {
        ...sessionUser(res),
        emailVerificationRequired: true,
      });
      navigate("/verify-email");
    } catch (err: unknown) {
      // Stable error code of the API (RFC 7807 body), never the English `detail` text
      const failure = opaqueFailureKind(err);
      if (failure) {
        fail(failure);
      } else if (isRateLimited(err)) {
        setRateText(rateLimitText(t, err));
        fail("rate");
      } else if ((err as { code?: string }).code === "email_taken") {
        fail("exists");
      } else if ((err as { code?: string }).code === "registration_restricted") {
        fail("restricted");
      } else if (
        ["consent_outdated", "consent_required"].includes((err as { code?: string }).code ?? "")
      ) {
        // A document was replaced while the form was open: show the new list, ask again.
        setAccepted(new Set());
        const fresh = await qc
          .fetchQuery({
            queryKey: legalKeys.overview,
            queryFn: () => apiGet<LegalOverview>("/api/legal"),
            staleTime: 0,
          })
          .catch(() => null);
        const stale: Record<string, string> = {};
        for (const type of CONSENT_TYPES) {
          const doc = fresh?.[type];
          if (doc) stale[doc.id] = t(`consent.required.${type}`);
        }
        fail("consent");
        setConsentErrors(stale);
      } else {
        fail("generic");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      className="ap-form"
      aria-label={t("auth.createAccount")}
      onSubmit={handleSubmit}
      noValidate
    >
      {problem && (
        <FocusBanner
          key={problemKey}
          tone="danger"
          title={t(problem === "rate" ? "auth.rateLimitedTitle" : "auth.register.errorTitle")}
          action={
            problem === "exists" ? (
              <Button variant="secondary" onClick={onBack}>
                {t("auth.register.toLogin")}
              </Button>
            ) : undefined
          }
        >
          {problem === "rate"
            ? rateText
            : problem === "unsupported"
              ? t("auth.opaqueUnsupported")
              : problem === "unavailable"
                ? t("auth.opaqueUnavailable")
                : t(
                    problem === "exists"
                      ? "auth.register.problem.exists"
                      : problem === "consent"
                        ? "consent.outdated"
                        : problem === "restricted"
                          ? "auth.register.emailRestrictedField"
                          : "auth.register.problem.generic",
                  )}
        </FocusBanner>
      )}
      <ErrorSummary
        title={t("auth.register.errorTitle")}
        errors={problem ? [] : summary}
        focusSignal={form.submits}
      />
      <Field id={IDS.name} label={t("auth.register.name")} required error={errors.name}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={(e) => form.touch("name", e)}
          autoComplete="name"
        />
      </Field>
      <Field id="signup-email" label={t("auth.email")}>
        <TextInput
          type="email"
          value={email}
          readOnly
          autoComplete="email"
          inputMode="email"
          spellCheck={false}
        />
      </Field>
      <PasswordField
        id={IDS.password}
        label={t("auth.password")}
        requiredLabel
        hint={t("auth.register.passwordHint")}
        error={errors.password}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={(e) => form.touch("password", e)}
        onFocus={protocol === "opaque" ? prefetchOpaque : undefined}
        autoComplete="new-password"
      />
      <PasswordField
        id={IDS.confirm}
        label={t("auth.register.confirmPassword")}
        requiredLabel
        error={errors.confirm}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        onBlur={(e) => form.touch("confirm", e)}
        autoComplete="new-password"
      />
      {consentItems.length > 0 && (
        <ConsentCheckboxes
          items={consentItems}
          idPrefix="signup-consent"
          checked={accepted}
          errors={consentErrors}
          onToggle={(id, on) => {
            setAccepted((prev) => {
              const next = new Set(prev);
              if (on) next.add(id);
              else next.delete(id);
              return next;
            });
            setConsentErrors((prev) => ({ ...prev, [id]: undefined }));
          }}
        />
      )}
      <Button
        type="submit"
        block
        loading={loading}
        disabled={legal.isPending}
        loadingLabel={t("auth.creatingAccount")}
      >
        {t("auth.createAccount")}
      </Button>
      <Button variant="ghost" block icon="arrow-left" onClick={onBack}>
        {t("auth.entry.back")}
      </Button>
    </form>
  );
}
