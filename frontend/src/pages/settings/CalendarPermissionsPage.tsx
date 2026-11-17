import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/ui/shared";
import { CalendarPermissions } from "@/components/settings/CalendarPermissions";
import { SettingsLayout } from "@/components/settings/SettingsLayout";
import { useSettingsPage } from "@/components/settings/useSettingsPage";

/** Settings "Berechtigungen" (club admins only): who besides the staff may edit this calendar. */
export default function CalendarPermissionsPage() {
  const { t } = useTranslation();
  const page = useSettingsPage();
  return (
    <SettingsLayout>
      {page.isAdmin ? (
        <CalendarPermissions clubId={page.clubId} calendarId={page.calendarId} />
      ) : (
        <EmptyState
          icon="lock"
          title={t("settings.permissions.adminOnlyTitle")}
          text={t("settings.permissions.adminOnlyText")}
        />
      )}
    </SettingsLayout>
  );
}
