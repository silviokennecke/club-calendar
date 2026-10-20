import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Icon,
  LinkButton,
  Skeleton,
  StatusBadge,
  buttonClass,
  toast,
} from "@/components/ui/shared";
import { AudienceTags } from "@/components/feeds/AudienceTags";
import { CalendarTags } from "@/components/feeds/CalendarTags";
import { FeedsForbidden } from "@/components/feeds/FeedsForbidden";
import { FeedAccess } from "@/components/feeds/FeedAccess";
import { useFeeds } from "@/components/feeds/useFeeds";
import { useClubSettingsPage } from "@/components/settings/useClubSettingsPage";
import { ClubSettingsTabs } from "@/components/layout/SettingsTabs";
import { apiDelete } from "@/lib/api";
import { feedStatus } from "@/lib/feeds";
import { focusAfterDialog } from "@/lib/focus";
import type { CalendarFeed } from "@/lib/types";
import { usePageTitle } from "@/lib/usePageTitle";

/**
 * Publish (design: Feeds): the feeds of the club (club settings; a feed can span several calendars) with their status (word + icon: public, club
 * internal, private; "findable" for public feeds with the search engine option), audiences and the
 * addresses (ICS, webcal, web; secret for private feeds) behind a disclosure. Creating and editing
 * happen on their own pages (/clubs/:clubId/settings/feeds/new, …/feeds/:feedId).
 */
export default function FeedsPage() {
  const { t } = useTranslation();
  usePageTitle(t("feeds.title"));
  const page = useClubSettingsPage();
  const qc = useQueryClient();
  const location = useLocation();
  const data = useFeeds(page.clubId, { withList: page.canEdit });
  // Feeds are managed by club admins; editors only view them, viewers do not see them at all.
  const readOnly = !page.isAdmin;
  const fromState = (location.state as { open?: string } | null)?.open;
  // The first feed is open by default (like in the design); a freshly saved one opens instead.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(
    fromState ? { [fromState]: true } : {},
  );
  const [deleting, setDeleting] = useState<CalendarFeed | null>(null);

  const list = data.feeds.data ?? [];
  const emptyList = data.feeds.isSuccess && list.length === 0;
  const isOpen = (feed: CalendarFeed, index: number) =>
    openMap[feed.id] ?? (!fromState && index === 0);

  async function remove(feed: CalendarFeed) {
    try {
      await apiDelete(`/api/clubs/${page.clubId}/feeds/${feed.id}`);
      await qc.invalidateQueries({ queryKey: ["feeds", page.clubId] });
      toast.success(t("feeds.delete.done", { name: feed.name }));
      focusAfterDialog("feeds-h1");
    } catch {
      toast.error(t("feeds.delete.failed"));
    }
  }

  let content;
  if (page.roleLoading || data.feeds.isLoading) {
    content = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("feeds.loading")}
        </p>
        {[0, 1].map((i) => (
          <Skeleton key={i} style={{ display: "block", height: 120 }} />
        ))}
      </div>
    );
  } else if (data.feeds.isError && !data.feeds.data) {
    content = (
      <Banner
        tone="danger"
        title={t("feeds.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void data.feeds.refetch()}>
            {t("feeds.loadError.retry")}
          </Button>
        }
      >
        {t("feeds.loadError.text")}
      </Banner>
    );
  } else if (list.length === 0) {
    content = (
      <section className="ap-panel" aria-label={t("feeds.empty.label")}>
        <EmptyState
          icon="rss"
          title={t("feeds.empty.title")}
          text={readOnly ? t("feeds.empty.readOnly") : t("feeds.empty.text")}
          actions={
            readOnly ? undefined : (
              <LinkButton icon="plus" to={page.routes.feedNew}>
                {t("feeds.create")}
              </LinkButton>
            )
          }
        />
      </section>
    );
  } else {
    content = (
      <ul className="ap-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {list.map((feed, index) => {
          const open = isOpen(feed, index);
          const titleId = `feed-${feed.id}-t`;
          const bodyId = `feed-${feed.id}-body`;
          return (
            <li key={feed.id}>
              <section className="ap-panel ap-stack" aria-labelledby={titleId}>
                <div
                  className="ap-row"
                  style={{ justifyContent: "space-between", alignItems: "flex-start" }}
                >
                  <div className="ap-stack ap-stack--sm" style={{ minWidth: 0 }}>
                    <div className="ap-row">
                      <h2 className="t-h3" id={titleId}>
                        {feed.name}
                      </h2>
                      <StatusBadge status={feedStatus(feed.visibility)} />
                    </div>
                    <CalendarTags feed={feed} calendars={page.calendars} />
                    <AudienceTags feed={feed} data={data} />
                  </div>
                  <div className="ap-actions">
                    <Button
                      variant="secondary"
                      icon={open ? "chevron-up" : "chevron-down"}
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => setOpenMap((m) => ({ ...m, [feed.id]: !open }))}
                    >
                      {open ? t("feeds.hideAccess") : t("feeds.showAccess")}
                    </Button>
                    {!readOnly && (
                      <>
                        <Link
                          className={buttonClass("secondary")}
                          to={page.routes.feed(feed.id)}
                          aria-label={t("feeds.editLabel", { name: feed.name })}
                        >
                          <Icon glyph="edit" size={18} />
                          {t("feeds.edit")}
                        </Link>
                        <IconButton
                          variant="danger"
                          className="ap-iconbtn--outline"
                          icon="trash"
                          label={t("feeds.deleteLabel", { name: feed.name })}
                          onClick={() => setDeleting(feed)}
                        />
                      </>
                    )}
                  </div>
                </div>
                {open && (
                  <div id={bodyId}>
                    <FeedAccess feed={feed} addresses={data.addresses(feed)} withSecret />
                  </div>
                )}
              </section>
            </li>
          );
        })}
      </ul>
    );
  }

  if (!page.roleLoading && !page.canEdit) return <FeedsForbidden backHref={page.routes.club} />;

  return (
    <div className="ap-wrap">
      <header className="ap-pagehead">
        <div>
          <h1 className="t-h1 ap-focus-target" id="feeds-h1" tabIndex={-1}>
            {t("feeds.title")}
          </h1>
          <p className="t-body">
            {[page.club?.name, data.feeds.data ? t("feeds.count", { count: list.length }) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="ap-actions">
          {page.calendarHref && (
            <LinkButton
              variant="secondary"
              icon="download"
              to={`${page.calendarHref}/events/export`}
            >
              {t("feeds.export")}
            </LinkButton>
          )}
          {!readOnly && !emptyList && (
            <LinkButton icon="plus" to={page.routes.feedNew}>
              {t("feeds.create")}
            </LinkButton>
          )}
        </div>
      </header>
      <ClubSettingsTabs clubId={page.clubId} role={page.club?.role} />
      <div className="ap-stack ap-stack--lg">
        {readOnly ? (
          <Banner tone="info" icon="lock">
            {t("feeds.readOnlyRole")}
          </Banner>
        ) : (
          <Banner tone="info">{t("feeds.intro")}</Banner>
        )}
        {content}
      </div>
      {!readOnly && !emptyList && (
        <LinkButton className="ap-fab" icon="plus" to={page.routes.feedNew}>
          {t("feeds.create")}
        </LinkButton>
      )}

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={t("feeds.delete.title", { name: deleting.name })}
          description={t("feeds.delete.text")}
          consequence={t("feeds.delete.consequence")}
          confirmLabel={t("feeds.delete.confirm")}
          onConfirm={() => remove(deleting)}
        />
      )}
    </div>
  );
}
