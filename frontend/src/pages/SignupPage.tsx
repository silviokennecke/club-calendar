import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "@/lib/api";
import {
  consentCheckboxId,
  legalKeys,
  useLegalOverview,
  type LegalOverview,
  type LegalType,
} from "@/lib/legal";
import { useRegistrationInfo } from "@/lib/registration";
import { isEmailShape } from "@/lib/email";
import { passwordProblem } from "@/lib/password";
import { useFieldTouch } from "@/lib/useFieldTouch";
import i18n from "@/lib/i18n";
import {
  Banner,
  Button,
  ErrorSummary,
  Field,
  LinkButton,
  PasswordField,
  TextInput,
} from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { FocusBanner } from "@/components/auth/FocusBanner";
import { ConsentCheckboxes } from "@/components/legal/ConsentCheckboxes";

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

type Problem = "exists" | "generic" | "consent" | "restricted";

/** Documents the user has to accept at signup (when the operator provides them). */
const CONSENT_TYPES: readonly LegalType[] = ["privacy", "terms"];

const IDS = {
  name: "signup-name",
  email: "signup-email",
  password: "signup-password",
  confirm: "signup-confirm",
} as const;

export default function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useFieldTouch<keyof FieldErrors>();
  // Answers of the API (address taken / restricted); dropped as soon as the address is edited.
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [problemKey, setProblemKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  const legal = useLegalOverview();
  const restricted = useRegistrationInfo().data?.restricted === true;
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

  function fail(next: Problem, fieldErrors: FieldErrors = {}) {
    setServerErrors(fieldErrors);
    setProblem(next);
    setProblemKey((k) => k + 1);
  }

  const found: FieldErrors = {};
  if (!name.trim()) found.name = t("auth.register.nameMissing");
  if (!email.trim()) found.email = t("auth.register.emailMissing");
  else if (!isEmailShape(email)) found.email = t("auth.emailInvalid");
  const pwProblem = passwordProblem(password);
  if (pwProblem === "missing") found.password = t("auth.register.passwordMissing");
  else if (pwProblem === "short") found.password = t("auth.register.passwordShortField");
  else if (pwProblem === "long") found.password = t("auth.register.passwordLongField");
  if (password && confirm !== password) found.confirm = t("auth.register.confirmMismatchField");

  const errors: FieldErrors = {};
  for (const k of ["name", "email", "password", "confirm"] as const) {
    errors[k] = serverErrors[k] ?? (form.shown(k) ? found[k] : undefined);
  }

  const summary: { fieldId: string; message: string }[] = [
    ...(["name", "email", "password", "confirm"] as const).flatMap((k) =>
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
    setServerErrors({});
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
      const res = await apiPost<{ email?: string } | undefined>("/api/auth/register", {
        name,
        email,
        password,
        language: i18n.resolvedLanguage ?? "en",
        acceptedDocuments: consentItems.map((i) => i.id),
      });
      // no tokens yet: the address is confirmed with the code from the e-mail
      navigate(`/verify-email?email=${encodeURIComponent(res?.email ?? email)}`);
    } catch (err: unknown) {
      // Stable error code of the API (RFC 7807 body), never the English `detail` text
      if ((err as { code?: string }).code === "email_taken") {
        fail("exists", { email: t("auth.register.emailExistsField") });
      } else if ((err as { code?: string }).code === "registration_restricted") {
        fail("restricted", { email: t("auth.register.emailRestrictedField") });
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
    <AuthLayout
      title={t("auth.createAccount")}
      footer={
        <>
          {t("auth.register.haveAccount")}{" "}
          <Link to="/login" className="ap-link">
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      {restricted && <Banner tone="info">{t("auth.register.restrictedHint")}</Banner>}
      {problem && (
        <FocusBanner
          key={problemKey}
          tone="danger"
          title={t("auth.register.errorTitle")}
          action={
            problem === "exists" ? (
              <LinkButton to="/login" variant="secondary">
                {t("auth.register.toLogin")}
              </LinkButton>
            ) : undefined
          }
        >
          {t(
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
      <form
        className="ap-form"
        aria-label={t("auth.createAccount")}
        onSubmit={handleSubmit}
        noValidate
      >
        <ErrorSummary
          title={t("auth.register.errorTitle")}
          errors={problem ? [] : summary}
          focusSignal={form.submits}
        />
        <Field id={IDS.name} label={t("auth.register.name")} required error={errors.name}>
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => form.touch("name")}
            autoComplete="name"
          />
        </Field>
        <Field id={IDS.email} label={t("auth.email")} required error={errors.email}>
          <TextInput
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setServerErrors((prev) => (prev.email ? { ...prev, email: undefined } : prev));
            }}
            onBlur={() => form.touch("email")}
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
          onBlur={() => form.touch("password")}
          autoComplete="new-password"
        />
        <PasswordField
          id={IDS.confirm}
          label={t("auth.register.confirmPassword")}
          requiredLabel
          error={errors.confirm}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => form.touch("confirm")}
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
      </form>
    </AuthLayout>
  );
}
