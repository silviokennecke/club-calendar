import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ResourceManager from "@/components/settings/ResourceManager";

export default function TargetGroupsPage() {
  const { t } = useTranslation();
  const params = useParams<{ calendarId: string }>();
  const calendarId = params.calendarId!;
  const path = `/api/calendars/${calendarId}/target-groups`;
  return (
    <div className="max-w-2xl p-6">
      <p className="mb-6 text-sm text-slate-500">{t("settings.targetGroups.description")}</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={["targetGroups", calendarId]}
        title={t("settings.targetGroups.title")}
        emptyMessage={t("settings.targetGroups.noTargetGroups")}
        deleteTitle={t("settings.targetGroups.deleteTargetGroup")}
        deleteDescription={t("settings.targetGroups.cannotBeUndone")}
        fields={[{ key: "name", label: t("common.name"), placeholder: "Group name" }]}
        renderItem={(item) => (
          <span className="text-sm font-medium text-slate-800">{String(item.name)}</span>
        )}
      />
    </div>
  );
}
