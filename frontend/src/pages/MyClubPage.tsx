import { useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Banner, Button, LinkButton } from "@/components/ui/shared";
import { HelpTabs } from "@/components/help/HelpTabs";
import { LeaveClubDialog } from "@/components/club/LeaveClubDialog";
import { MyCalendarTab } from "@/components/myclub/MyCalendarTab";
import { MySubscriptionTab } from "@/components/myclub/MySubscriptionTab";
import type { ShellData } from "@/components/layout/shellTypes";
import { MY_CLUB_TABS, parseMyClubTab } from "@/lib/club/myClub";
import { usePageTitle } from "@/lib/usePageTitle";

/**
 * "Mein Verein": the club area every member can use (the only one for the role `member`). Tab
 * "Kalender" shows the events of the personal subscription, tab "Abo" manages it (`?tab=`). Leaving the
 * club is open to every role.
 */
export default function MyClubPage() {
  const { t } = useTranslation();
  usePageTitle(t("myClub.title"));
  const data = useOutletContext<ShellData>();
  const [params, setParams] = useSearchParams();
  const [leaving, setLeaving] = useState(false);
  const tab = parseMyClubTab(params.get("tab"));
  const club = data.clubs.find((c) => c.id === data.clubId);

  if (!club) {
    return (
      <div className="ap-wrap">
        <header className="ap-pagehead">
          <h1 className="t-h1">{t("myClub.title")}</h1>
        </header>
        {data.contextState === "unavailable" ? (
          <Banner
            tone="danger"
            title={t("club.notFound.title")}
            action={
              <LinkButton to="/clubs?select=1" icon="building">
                {t("club.allClubs")}
              </LinkButton>
            }
          >
            {t("club.notFound.text")}
          </Banner>
        ) : (
          <p role="status">{t("club.loading")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("myClub.title")}</h1>
          <p className="t-body">
            {t("myClub.subtitle", {
              name: club.name,
              role: t(`club.roles.${club.role ?? "member"}`),
            })}
          </p>
        </div>
        <div className="ap-actions">
          <Button variant="secondary" icon="log-out" onClick={() => setLeaving(true)}>
            {t("myClub.leave")}
          </Button>
        </div>
      </header>
      <div className="ap-stack ap-stack--lg">
        <HelpTabs
          label={t("myClub.tabs.label")}
          idPrefix="myclub"
          tabs={MY_CLUB_TABS.map((id) => ({ id, label: t(`myClub.tabs.${id}`) }))}
          value={tab}
          onChange={(id) => setParams({ tab: id }, { replace: true })}
        />
        <div
          className="ap-stack ap-stack--lg"
          role="tabpanel"
          id={`myclub-panel-${tab}`}
          aria-labelledby={`myclub-tab-${tab}`}
        >
          {tab === "calendar" && <MyCalendarTab clubId={club.id} />}
          {tab === "subscription" && <MySubscriptionTab clubId={club.id} />}
        </div>
      </div>
      {leaving && <LeaveClubDialog club={club} onClose={() => setLeaving(false)} />}
    </div>
  );
}
