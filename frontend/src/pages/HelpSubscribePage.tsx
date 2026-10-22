import { useNavigate, useSearchParams } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { Banner, Button } from "@/components/ui/shared";
import { PublicShell } from "@/components/feed/PublicShell";
import { HelpStep } from "@/components/help/HelpStep";
import { HelpTabs } from "@/components/help/HelpTabs";
import {
  GUIDES,
  HELP_APPS,
  isHelpApp,
  screenshotSrc,
  type HelpApp,
} from "@/components/help/guides";
import { useMetaTag } from "@/lib/useMetaTag";
import { detectPlatform, type Platform } from "@/lib/platform";

const PRESELECT: Record<Platform, HelpApp> = {
  ios: "ios",
  macos: "macos",
  windows: "outlook",
  android: "google",
  other: "google",
};

const bold = { b: <strong /> };

export default function HelpSubscribePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  useMetaTag("description", t("helpSubscribe.description"));

  const param = params.get("app");
  const app: HelpApp = isHelpApp(param) ? param : PRESELECT[detectPlatform()];
  const guide = GUIDES[app];

  function goBack() {
    // idx > 0: there is an in-app page to return to, otherwise (direct visit) go home.
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate("/");
  }

  return (
    <PublicShell
      title={t("helpSubscribe.title")}
      indexable
      hero={
        <div className="pt-6 pb-4">
          <Button variant="ghost" icon="chevron-left" onClick={goBack}>
            {t("common.back")}
          </Button>
          <h1 className="t-display mt-4 mb-0">{t("helpSubscribe.title")}</h1>
        </div>
      }
    >
      <div className="max-w-[44rem] pb-8">
        <p>{t("helpSubscribe.intro")}</p>
        <p>
          <Trans i18nKey="helpSubscribe.link" components={bold} />
        </p>

        <h2 className="t-h2">{t("helpSubscribe.choose")}</h2>
        <HelpTabs
          idPrefix="help"
          label={t("helpSubscribe.choose")}
          tabs={HELP_APPS.map((id) => ({ id, label: t(`helpSubscribe.tabs.${id}`) }))}
          value={app}
          onChange={(id) => setParams({ app: id }, { replace: true })}
        />

        <div role="tabpanel" id={`help-panel-${app}`} aria-labelledby={`help-tab-${app}`}>
          <p>
            <Trans i18nKey={`helpSubscribe.${app}.lead`} components={bold} />
          </p>
          <ol className="m-0 list-decimal pl-6">
            {guide.steps.map((step, i) => (
              <HelpStep
                key={step.id}
                src={screenshotSrc(app, i + 1)}
                alt={t(`helpSubscribe.${app}.steps.${step.id}.alt`)}
              >
                <Trans i18nKey={`helpSubscribe.${app}.steps.${step.id}.text`} components={bold} />
              </HelpStep>
            ))}
          </ol>
          <p>
            <Trans i18nKey={`helpSubscribe.${app}.done`} components={bold} />
          </p>
          <Banner title={t("helpSubscribe.troubleTitle")}>
            <Trans i18nKey={`helpSubscribe.${app}.trouble`} components={bold} />
          </Banner>
        </div>
      </div>
    </PublicShell>
  );
}
