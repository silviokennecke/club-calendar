import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import type { EventTemplate } from "@/lib/types";
import { Banner, Button, EmptyState, Icon, LinkButton, Modal } from "@/components/ui/shared";
import { useEventPage } from "@/components/events/useEventPage";
import { useTemplateMeta } from "@/components/events/useTemplateMeta";
import { CreateGateBody, ModalSkeleton } from "@/components/events/CreateGate";
import { createGate } from "@/components/events/createGateState";
import { useModalNav } from "@/lib/useModalNav";

/**
 * "Vorlage wählen" (design: EventNewTemplate; step of the create dialog,
 * route …/events/new/template?date=).
 */
export default function EventTemplatePickModal() {
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();
  const gate = createGate(page);
  return (
    <Modal
      size="wide"
      title={gate === "archived" ? t("events.new.archived.title") : t("events.templatePick.title")}
      subtitle={gate ? undefined : t("events.templatePick.subtitle")}
      closeLabel={t("events.new.close")}
      onClose={nav.close}
    >
      {gate ? <CreateGateBody gate={gate} page={page} onClose={nav.close} /> : <TemplatePick />}
    </Modal>
  );
}

function TemplatePick() {
  const page = useEventPage();
  const nav = useModalNav();
  const { t } = useTranslation();
  const meta = useTemplateMeta();
  const [params] = useSearchParams();
  const date = params.get("date");
  const [picked, setPicked] = useState<string | null>(null);

  const templates = useQuery<EventTemplate[]>({
    queryKey: ["templates", page.calendarId],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${page.calendarId}/templates`),
  });
  const list = templates.data ?? [];
  const selected = picked ?? list[0]?.id ?? null;

  function next(e: FormEvent) {
    e.preventDefault();
    if (selected) nav.step(page.routes.fromTemplate(selected, date));
  }

  let body;
  if (templates.isLoading) {
    body = <ModalSkeleton label={t("events.templatePick.loading")} />;
  } else if (templates.isError) {
    body = (
      <Banner
        tone="danger"
        title={t("events.templatePick.error")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => templates.refetch()}>
            {t("events.list.error.retry")}
          </Button>
        }
      />
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon="layers"
        title={t("events.templatePick.empty.title")}
        text={t("events.templatePick.empty.text")}
        actions={
          <LinkButton variant="secondary" to={page.routes.templates}>
            {t("events.templatePick.empty.action")}
          </LinkButton>
        }
      />
    );
  } else {
    body = (
      <fieldset className="ap-fieldset">
        <legend>{t("events.templatePick.legend")}</legend>
        {list.map((tpl) => (
          <label key={tpl.id} className="ap-optionrow">
            <input
              type="radio"
              name="tpl"
              value={tpl.id}
              checked={selected === tpl.id}
              onChange={() => setPicked(tpl.id)}
            />
            <span className="ap-listrow-main">
              <b>{tpl.name}</b>
              <span>{meta(tpl)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    );
  }

  return (
    <form className="ap-stack ap-stack--lg" onSubmit={next}>
      {body}
      <div className="ap-dialog-foot ap-dialog-foot--split">
        <LinkButton
          variant="secondary"
          icon="arrow-left"
          {...nav.stepLink(page.routes.create(date))}
        >
          {t("events.templatePick.back")}
        </LinkButton>
        <button type="submit" className="cc-btn cc-btn--primary" disabled={!selected}>
          {t("events.templatePick.next")}
          <Icon glyph="arrow-right" size={18} />
        </button>
      </div>
    </form>
  );
}
