import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ChipSelect,
  EmptyState,
  Skeleton,
  StatusBadge,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { SubscribeButton } from "@/components/feed/SubscribeButton";
import { PersonalLink } from "@/components/myclub/PersonalLink";
import {
  mySubscriptionAddresses,
  useMyFeeds,
  useMySubscription,
  useReplaceMySubscription,
} from "@/lib/club/memberApi";
import { feedStatus, requiresSecret, toggleId } from "@/lib/feeds";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";

interface Selection {
  feedIds: string[];
  groupIds: string[];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Tab "Abo" of Mein Verein: which feeds and audiences the personal calendar contains (saved
 * explicitly) and the personal address for calendar apps. Renewing that address is in the profile.
 */
export function MySubscriptionTab({ clubId }: { clubId: string }) {
  const { t } = useTranslation();
  const subscription = useMySubscription(clubId);
  const feeds = useMyFeeds(clubId);
  const save = useReplaceMySubscription(clubId);
  const [draft, setDraft] = useState<Selection | null>(null);

  const saved: Selection | null =
    feeds.data && subscription.data
      ? {
          feedIds: feeds.data.feeds.filter((f) => f.selected).map((f) => f.id),
          groupIds: subscription.data.targetGroupIds,
        }
      : null;
  const value = draft ?? saved;
  const dirty =
    !!draft &&
    !!saved &&
    (!sameSet(draft.feedIds, saved.feedIds) || !sameSet(draft.groupIds, saved.groupIds));
  const unsaved = useUnsavedChanges(dirty);

  if (subscription.isPending || feeds.isPending) {
    return (
      <div aria-busy="true">
        <p className="ap-sr" role="status">
          {t("myClub.subscription.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 240 }} />
      </div>
    );
  }
  if (!subscription.data || !feeds.data || !value) {
    return (
      <EmptyState
        icon="alert"
        title={t("myClub.subscription.errorTitle")}
        text={t("myClub.subscription.errorText")}
        actions={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              void subscription.refetch();
              void feeds.refetch();
            }}
          >
            {t("myClub.calendar.retry")}
          </Button>
        }
      />
    );
  }

  const { feeds: options, targetGroups } = feeds.data;
  const hasPrivate = options.some((f) => requiresSecret(f.visibility));
  const addresses = mySubscriptionAddresses(subscription.data);

  async function submit() {
    try {
      await save.mutateAsync({ feedIds: value!.feedIds, targetGroupIds: value!.groupIds });
      setDraft(null);
      toast.success(t("myClub.subscription.saved"));
    } catch {
      toast.error(t("myClub.subscription.saveFailed"));
    }
  }

  return (
    <div className="ap-stack ap-stack--lg">
      <section className="ap-panel ap-stack" aria-labelledby="mysub-feeds">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="mysub-feeds">
              {t("myClub.subscription.feeds.title")}
            </h2>
            <p>{t("myClub.subscription.feeds.text")}</p>
          </div>
        </div>
        {options.length === 0 ? (
          <EmptyState
            icon="rss"
            headingLevel="h3"
            title={t("myClub.subscription.feeds.emptyTitle")}
            text={t("myClub.subscription.feeds.emptyText")}
          />
        ) : (
          <ul className="ap-stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {options.map((feed) => (
              <li key={feed.id}>
                <label className="ap-check">
                  <input
                    type="checkbox"
                    checked={value.feedIds.includes(feed.id)}
                    onChange={() =>
                      setDraft({ ...value, feedIds: toggleId(value.feedIds, feed.id) })
                    }
                  />
                  <span>
                    <span className="ap-row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
                      <strong>{feed.name}</strong>
                      <StatusBadge status={feedStatus(feed.visibility)} />
                    </span>
                    <small>
                      {feed.calendarNames.join(", ")}
                      {feed.calendarNames.length > 0 && " · "}
                      {t(`myClub.subscription.reason.${feed.accessReason}`)}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {hasPrivate && <Banner tone="info">{t("myClub.subscription.feeds.privateHint")}</Banner>}
      </section>

      <section className="ap-panel ap-stack" aria-labelledby="mysub-groups">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="mysub-groups">
              {t("myClub.subscription.groups.title")}
            </h2>
            <p>{t("myClub.subscription.groups.text")}</p>
          </div>
        </div>
        {targetGroups.length > 0 ? (
          <ChipSelect
            label={t("myClub.subscription.groups.label")}
            options={targetGroups.map((g) => ({ id: g.id, label: g.name }))}
            selected={value.groupIds}
            onChange={(groupIds) => setDraft({ ...value, groupIds })}
            hint={
              value.groupIds.length === 0
                ? t("myClub.subscription.groups.hintAll")
                : t("myClub.subscription.groups.hintSome")
            }
          />
        ) : (
          <p className="t-sm t-muted">{t("myClub.subscription.groups.none")}</p>
        )}
        <div className="ap-actions">
          <Button onClick={() => void submit()} disabled={!dirty || save.isPending}>
            {t("myClub.subscription.save")}
          </Button>
          {dirty && (
            <Button variant="secondary" onClick={() => setDraft(null)} disabled={save.isPending}>
              {t("myClub.subscription.discard")}
            </Button>
          )}
        </div>
      </section>

      <section className="ap-panel ap-stack" aria-labelledby="mysub-link">
        <div className="ap-panel-head">
          <div>
            <h2 className="t-h2" id="mysub-link">
              {t("myClub.subscription.link.title")}
            </h2>
            <p>{t("myClub.subscription.link.text")}</p>
          </div>
          <SubscribeButton
            addresses={addresses}
            name={t("myClub.subscription.link.calendarName")}
          />
        </div>
        <PersonalLink subscription={subscription.data} id="mysub-address" />
      </section>
      <UnsavedChangesDialog {...unsaved.dialog} />
    </div>
  );
}
