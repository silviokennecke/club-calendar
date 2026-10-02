import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "@/lib/api";
import type { EventTemplate } from "@/lib/types";
import { Banner, Button, EmptyState, Icon, LinkButton, Skeleton } from "@/components/ui/shared";
import { EventPageHead } from "@/components/events/EventPageHead";
import { useEventPage } from "@/components/events/useEventPage";
import { useTemplateMeta } from "@/components/events/useTemplateMeta";
import { ArchivedCreateGuard } from "@/components/events/ArchivedCreateGuard";

/** "Vorlage wählen" (design: EventNewTemplate, route …/events/new/template?date=). */
export default function EventTemplatePickPage() {
  return (
    <ArchivedCreateGuard>
      <TemplatePick />
    </ArchivedCreateGuard>
  );
}

function TemplatePick() {
  const page = useEventPage();
  const navigate = useNavigate();
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
    if (selected) navigate(page.routes.fromTemplate(selected, date), { state: page.navState });
  }

  let body;
  if (templates.isLoading) {
    body = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("events.templatePick.loading")}
        </p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ display: "block", height: 64 }} />
        ))}
      </div>
    );
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
    <form className="ap-pagedialog ap-pagedialog--wide" onSubmit={next}>
      <EventPageHead
        title={t("events.templatePick.title")}
        subtitle={t("events.templatePick.subtitle")}
        closeLabel={t("events.new.close")}
        onClose={() => navigate(page.returnTo)}
      />
      {body}
      <div className="ap-dialog-foot ap-dialog-foot--split">
        <LinkButton
          variant="secondary"
          icon="arrow-left"
          to={page.routes.create(date)}
          state={page.navState}
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
