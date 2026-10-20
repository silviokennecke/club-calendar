import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiDelete, apiGet } from "@/lib/api";
import { matchesTemplateQuery, templateDeleteConsequence, templateTimes } from "@/lib/templates";
import type { EventTemplate, TargetGroup } from "@/lib/types";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  LinkButton,
  SearchInput,
  Skeleton,
  Tag,
  toast,
} from "@/components/ui/shared";
import { useEventPage } from "@/components/events/useEventPage";
import { openModalState } from "@/lib/modalRoutes";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { locationName } from "@/lib/events";
import { preloadEventModals } from "./lazy";

/**
 * Templates of a calendar (design: Templates): cards with time, place, audiences and tags, a search,
 * the empty state and "Termin aus Vorlage" / "Bearbeiten" / delete. Creating and editing happen on
 * their own pages (…/templates/new, …/templates/:templateId).
 */
export default function TemplatesPage() {
  useEffect(preloadEventModals, []);
  const page = useEventPage();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [deleting, setDeleting] = useState<EventTemplate | null>(null);
  const here = location.pathname + location.search;
  const readOnly = page.readOnly;

  const templates = useQuery<EventTemplate[]>({
    queryKey: ["templates", page.calendarId],
    queryFn: () => apiGet<EventTemplate[]>(`/api/calendars/${page.calendarId}/templates`),
  });
  const groups = useQuery<TargetGroup[]>({
    queryKey: ["targetGroups", page.clubId],
    queryFn: () => apiGet<TargetGroup[]>(`/api/clubs/${page.clubId}/target-groups`),
  });
  const toneOf = (id: string) => audienceTone((groups.data ?? []).findIndex((g) => g.id === id));

  const all = templates.data ?? [];
  const shown = all.filter((tpl) => matchesTemplateQuery(tpl, query));

  function setQuery(q: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set("q", q);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  }

  async function remove(tpl: EventTemplate) {
    try {
      await apiDelete(`/api/calendars/${page.calendarId}/templates/${tpl.id}`);
      await qc.invalidateQueries({ queryKey: ["templates", page.calendarId] });
      toast.success(t("templates.delete.done"));
    } catch {
      toast.error(t("templates.delete.failed"));
    }
  }

  let content;
  if (templates.isLoading) {
    content = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("templates.loading")}
        </p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={{ display: "block", height: 160 }} />
        ))}
      </div>
    );
  } else if (templates.isError && !templates.data) {
    content = (
      <Banner
        tone="danger"
        title={t("templates.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => templates.refetch()}>
            {t("templates.loadError.retry")}
          </Button>
        }
      >
        {t("templates.loadError.text")}
      </Banner>
    );
  } else if (all.length === 0) {
    content = (
      <section className="ap-panel" aria-label={t("templates.empty.label")}>
        <EmptyState
          icon="layers"
          title={t("templates.empty.title")}
          text={t("templates.empty.text")}
          actions={
            readOnly ? undefined : (
              <LinkButton icon="plus" to={page.routes.templateNew} state={{ from: here }}>
                {t("templates.create")}
              </LinkButton>
            )
          }
        />
      </section>
    );
  } else if (shown.length === 0) {
    content = (
      <section className="ap-panel">
        <EmptyState
          icon="search"
          title={t("templates.noHits.title", { query: query.trim() })}
          text={t("templates.noHits.text")}
          actions={
            <Button variant="secondary" onClick={() => setQuery("")}>
              {t("templates.noHits.reset")}
            </Button>
          }
        />
      </section>
    );
  } else {
    content = (
      <ul className="ap-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {shown.map((tpl) => {
          const times = templateTimes(tpl);
          const extras: { id: string; name: string; icon?: string | null }[] = [
            ...tpl.properties.map((p) => ({
              id: `p-${p.property.id}`,
              name: p.property.name,
              icon: p.property.icon,
            })),
            ...tpl.features.map((f) => ({ id: `f-${f.feature.id}`, name: f.feature.name })),
          ];
          return (
            <li key={tpl.id} className="ap-panel ap-stack">
              <div
                className="ap-row ap-row--nowrap"
                style={{ justifyContent: "space-between", alignItems: "flex-start" }}
              >
                <div className="ap-stack ap-stack--sm">
                  <h2 className="t-h2">{tpl.name}</h2>
                  <p className="ap-row t-body">
                    <Icon glyph="clock" size={18} />
                    {times ? t("templates.time", times) : t("templates.allDay")}
                    <span aria-hidden="true">·</span>
                    <Icon glyph="map-pin" size={18} />
                    {tpl.location ? locationName(tpl.location) : t("templates.noPlace")}
                  </p>
                </div>
                {!readOnly && (
                  <IconButton
                    icon="trash"
                    variant="danger"
                    label={t("templates.deleteLabel", { name: tpl.name })}
                    onClick={() => {
                      setDeleting(tpl);
                      // Fresh eventCount for the consequence
                      void templates.refetch();
                    }}
                  />
                )}
              </div>
              <div className="ap-stack ap-stack--sm">
                <div className="ap-row" style={{ gap: "var(--space-2)" }}>
                  <span className="t-label">{t("templates.audiences")}</span>
                  {tpl.targetGroups.length > 0 ? (
                    <span className="cc-tags">
                      {tpl.targetGroups.map(({ targetGroup }) => (
                        <Tag key={targetGroup.id} tone={toneOf(targetGroup.id)}>
                          {targetGroup.name}
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="t-sm t-muted">{t("templates.everyone")}</span>
                  )}
                </div>
                <div className="ap-row" style={{ gap: "var(--space-2)" }}>
                  <span className="t-label">{t("templates.extras")}</span>
                  {extras.length > 0 ? (
                    <span className="cc-tags">
                      {extras.map((x) => (
                        <Tag key={x.id} emoji={x.icon}>
                          {x.name}
                        </Tag>
                      ))}
                    </span>
                  ) : (
                    <span className="t-sm t-muted">{t("templates.noExtras")}</span>
                  )}
                </div>
              </div>
              <div className="ap-actions">
                {!readOnly && (
                  <LinkButton
                    variant="secondary"
                    to={page.routes.fromTemplate(tpl.id)}
                    state={openModalState(location)}
                  >
                    {t("templates.useTemplate")}
                  </LinkButton>
                )}
                <LinkButton
                  variant="secondary"
                  to={page.routes.template(tpl.id)}
                  state={{ from: here }}
                  aria-label={t(readOnly ? "templates.viewLabel" : "templates.editLabel", {
                    name: tpl.name,
                  })}
                >
                  {t(readOnly ? "templates.view" : "templates.edit")}
                </LinkButton>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1">{t("templates.title")}</h1>
          <p className="t-body t-prose">{t("templates.description")}</p>
        </div>
        {!readOnly && !(templates.isSuccess && all.length === 0) && (
          <div className="ap-actions">
            <LinkButton icon="plus" to={page.routes.templateNew} state={{ from: here }}>
              {t("templates.create")}
            </LinkButton>
          </div>
        )}
      </header>

      {readOnly && (
        <Banner tone="warning" icon="lock" title={t("shell.archivedReadOnly")} className="mb-4">
          {t("templates.readOnly")}
        </Banner>
      )}

      {all.length > 0 && (
        <div className="ap-toolbar" style={{ marginBottom: "var(--space-4)" }}>
          <SearchInput
            className="ap-toolbar-search"
            value={query}
            onChange={setQuery}
            placeholder={t("templates.search")}
          />
          <p className="t-sm t-muted" role="status">
            {query.trim() ? t("templates.hits", { count: shown.length, total: all.length }) : ""}
          </p>
        </div>
      )}

      {content}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={t("templates.delete.title", { name: deleting.name })}
          description={t("templates.delete.text")}
          consequence={templateDeleteConsequence(
            all.find((x) => x.id === deleting.id) ?? deleting,
            t,
          )}
          confirmLabel={t("templates.delete.confirm")}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}
