import { useTranslation } from "react-i18next";
import { MasterList } from "@/components/settings/MasterList";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { useSettingsPage } from "@/components/settings/useSettingsPage";
import type { MasterKind } from "@/lib/settings";

/** Settings page of one reference list (design: SettingsProps / SettingsFeatures); the club-wide audiences have their own page. */
export default function MasterListPage({ kind }: { kind: Exclude<MasterKind, "audiences"> }) {
  const { t } = useTranslation();
  const page = useSettingsPage();
  return (
    <SettingsLayout>
      <p className="t-body t-muted t-prose">{t(`settings.master.${kind}.description`)}</p>
      <MasterList
        kind={kind}
        clubId={page.clubId}
        calendarId={page.calendarId}
        readOnly={page.readOnly}
      />
    </SettingsLayout>
  );
}
