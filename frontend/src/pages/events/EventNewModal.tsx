import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Icon, LinkButton, Modal } from "@/components/ui/shared";
import { useEventPage } from "@/components/events/useEventPage";
import { CreateGateBody } from "@/components/events/CreateGate";
import { createGate } from "@/components/events/createGateState";
import { useModalNav } from "@/lib/useModalNav";

/**
 * "Termin anlegen: Wie möchtest du starten?" (design: EventNew; dialog above the calendar or list,
 * route …/events/new?date=). The tiles are steps of the same dialog (history entry replaced).
 */
export default function EventNewModal() {
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const date = params.get("date");
  const gate = createGate(page);

  return (
    <Modal
      size="wide"
      title={gate === "archived" ? t("events.new.archived.title") : t("events.new.title")}
      subtitle={gate ? undefined : t("events.new.subtitle")}
      closeLabel={t("events.new.close")}
      onClose={nav.close}
    >
      {gate ? (
        <CreateGateBody gate={gate} page={page} onClose={nav.close} />
      ) : (
        <>
          <div className="ap-tiles">
            <Link className="ap-tile" {...nav.stepLink(page.routes.form(date))}>
              <span className="ap-tile-icon" aria-hidden="true">
                <Icon glyph="plus" size={32} />
              </span>
              <b className="t-h2">{t("events.new.blank.title")}</b>
              <span className="t-body">{t("events.new.blank.text")}</span>
            </Link>
            <Link className="ap-tile" {...nav.stepLink(page.routes.pickTemplate(date))}>
              <span className="ap-tile-icon" aria-hidden="true">
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
        </>
      )}
    </Modal>
  );
}
