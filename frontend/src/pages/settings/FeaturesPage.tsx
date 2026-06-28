import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ResourceManager from "@/components/settings/ResourceManager";

export default function FeaturesPage() {
  const { t } = useTranslation();
  const params = useParams<{ calendarId: string }>();
  const calendarId = params.calendarId!;
  const path = `/api/calendars/${calendarId}/features`;
  return (
    <div className="max-w-2xl p-6">
      <p className="mb-6 text-sm text-slate-500">{t("settings.features.description")}</p>
      <ResourceManager
        calendarId={calendarId}
        resourcePath={path}
        queryKey={["features", calendarId]}
        title={t("settings.features.title")}
        emptyMessage={t("settings.features.noFeatures")}
        deleteTitle={t("settings.features.deleteFeature")}
        deleteDescription={t("settings.features.cannotBeUndone")}
        fields={[{ key: "name", label: t("common.name"), placeholder: "Feature name" }]}
        renderItem={(item) => (
          <span className="text-sm font-medium text-slate-800">{String(item.name)}</span>
        )}
      />
    </div>
  );
}
