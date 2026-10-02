import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon, LinkButton } from "@/components/ui/shared";
import { EventPageHead } from "@/components/events/EventPageHead";
import { useEventPage } from "@/components/events/useEventPage";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";

/** "Termin anlegen: Wie möchtest du starten?" (design: EventNew, route …/events/new?date=). */
export default function EventNewPage() {
  return (
    <ArchivedCreateGuard>
      <EventNewChoice />
    </ArchivedCreateGuard>
  );
}

function EventNewChoice() {
  const page = useEventPage();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const date = params.get("date");

  return (
    <div className="ap-pagedialog ap-pagedialog--wide">
      <EventPageHead
        title={t("events.new.title")}
        subtitle={t("events.new.subtitle")}
        closeLabel={t("events.new.close")}
        onClose={() => navigate(page.returnTo)}
      />
      <div className="ap-tiles">
        <Link className="ap-tile" to={page.routes.form(date)} state={page.navState}>
          <span className="ap-tile-icon">
            <Icon glyph="plus" size={32} />
          </span>
          <b className="t-h2">{t("events.new.blank.title")}</b>
          <span className="t-body">{t("events.new.blank.text")}</span>
        </Link>
        <Link className="ap-tile" to={page.routes.pickTemplate(date)} state={page.navState}>
          <span className="ap-tile-icon">
            <Icon glyph="layers" size={32} />
          </span>
          <b className="t-h2">{t("events.new.template.title")}</b>
          <span className="t-body">{t("events.new.template.text")}</span>
        </Link>
      </div>
      <div>
        <LinkButton variant="ghost" icon="upload" to={page.routes.import}>
          {t("events.new.import")}
        </LinkButton>
      </div>
    </div>
  );
}
