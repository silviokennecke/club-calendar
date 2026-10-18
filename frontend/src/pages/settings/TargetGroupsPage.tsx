import { useTranslation } from "react-i18next";
import { ClubSettingsLayout } from "@/components/settings/ClubSettingsLayout";
import { MasterList } from "@/components/settings/MasterList";
import { useClubSettingsPage } from "@/components/settings/useClubSettingsPage";

/** Club settings "Gruppen" (design: SettingsAudiences): target groups are shared by all calendars of the club. */
export default function TargetGroupsPage() {
  const { t } = useTranslation();
  const page = useClubSettingsPage();
  return (
    <ClubSettingsLayout>
      <p className="t-body t-muted t-prose">{t("settings.master.audiences.description")}</p>
      <MasterList kind="audiences" clubId={page.clubId} readOnly={page.readOnly} />
    </ClubSettingsLayout>
  );
}
