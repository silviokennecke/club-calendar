import { lazy, Suspense, useEffect } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatWeekdayDate } from "@/lib/events/format";
import { buildEventIcs, downloadTextFile, icsFileName } from "@/lib/events/ics";
import {
  feedAudiences,
  feedTimeZone,
  findPublicEvent,
  mapLinkFor,
  publicFeedPath,
  type PublicFeedEvent,
} from "@/lib/feeds/public";
import { formatAddress } from "@/lib/types";
import { useModalNav } from "@/lib/useModalNav";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { useLocale } from "@/components/calendar/useLocale";
import { ModalSkeleton } from "@/components/events/CreateGate";
import { usePublicFeed } from "@/components/feed/usePublicFeed";
import { usePublicHead } from "@/components/feed/usePublicHead";
import { MapBoundary } from "@/components/locations/MapBoundary";
import { Button, Icon, Modal, Skeleton, Tag, buttonClass } from "@/components/ui/shared";

const PublicEventMap = lazy(() => import("@/components/feed/PublicEventMap"));

/**
 * Public event details (design: PublicEvent, PublicEventMobile) as a dialog above the public feed;
 * the URL /feed/:feedId/events/:eventId stays shareable (a direct call shows the feed below, at the
 * event's month). Date and time, place with map and text alternative, properties, features and
 * audiences, "Zum Kalender hinzufügen" (one-event ICS file made in the browser). The feed endpoint
 * has no single-event route, the event is picked from the feed (shared query cache with the feed).
 * The router state keeps the way back without the secret; the secret comes from the address.
 */
export default function PublicEventModal() {
  const { t } = useTranslation();
  const { feedId = "", eventId } = useParams<{ feedId: string; eventId: string }>();
  const [params] = useSearchParams();
  const secret = params.get("secret") || undefined;
  const feed = usePublicFeed(feedId, secret);
  const nav = useModalNav();

  const event = feed.data ? findPublicEvent(feed.data.events, eventId) : undefined;
  const eventDate = event?.date.slice(0, 10);
  const { hasStoredBackground, setBackground } = nav;
  // A shared link: show the feed at the event's month below the dialog (stored without the secret).
  useEffect(() => {
    if (!eventDate || hasStoredBackground) return;
    setBackground(publicFeedPath(feedId, undefined, { date: eventDate }));
  }, [eventDate, hasStoredBackground, setBackground, feedId]);

  const title = event
    ? `${event.name} – ${feed.data!.feed.name}`
    : feed.data
      ? t("feed.event.notFound.title")
      : t("feed.brand");
  // Private feeds (secret in the address) and states without an event are not indexed.
  usePublicHead({ title, noindex: !!secret || !event });

  const close = t("feed.event.close");

  if (feed.isPending) {
    return (
      <Modal
        size="wide"
        title={t("feed.event.loadingTitle")}
        closeLabel={close}
        onClose={nav.close}
      >
        <ModalSkeleton label={t("feed.loading")} />
      </Modal>
    );
  }

  if (!feed.data || !event) {
    // The feed itself failed (private, unknown, load error) or the event is unknown / a draft.
    const kind = feed.data ? "eventNotFound" : (feed.errorKind ?? "error");
    const titleKey =
      kind === "eventNotFound"
        ? "feed.event.notFound.title"
        : kind === "private"
          ? "feed.states.private.title"
          : kind === "notFound"
            ? "feed.states.notFound.title"
            : "feed.states.error.title";
    const textKey =
      kind === "eventNotFound"
        ? "feed.event.notFound.text"
        : kind === "private"
          ? "feed.states.private.text"
          : kind === "notFound"
            ? "feed.states.notFound.text"
            : "feed.states.error.text";
    return (
      <Modal size="wide" title={t(titleKey)} closeLabel={close} onClose={nav.close}>
        <p className="t-body">{t(textKey)}</p>
        <div className="ap-dialog-foot">
          {kind === "error" && (
            <Button variant="secondary" icon="refresh" onClick={() => void feed.refetch()}>
              {t("feed.states.error.retry")}
            </Button>
          )}
          <Button onClick={nav.close}>{t("feed.event.backToFeed")}</Button>
        </div>
      </Modal>
    );
  }

  return (
    <EventDetail
      event={event}
      feedName={feed.data.feed.name}
      zone={feedTimeZone(feed.data.events)}
      audiences={feedAudiences(feed.data.events)}
      onClose={nav.close}
    />
  );
}

interface EventDetailProps {
  event: PublicFeedEvent;
  feedName: string;
  zone: string | null;
  audiences: { id: string; name: string }[];
  onClose: () => void;
}

function EventDetail({ event, feedName, zone, audiences, onClose }: EventDetailProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const start = event.date.slice(0, 10);
  const end = event.dateEnd ? event.dateEnd.slice(0, 10) : start;
  const dateText =
    end > start
      ? t("feed.event.dateRange", {
          from: formatWeekdayDate(start, locale),
          to: formatWeekdayDate(end, locale),
        })
      : formatWeekdayDate(start, locale);
  const timeText = event.isAllDay
    ? t("feed.event.allDay")
    : t("feed.event.timeRange", { from: event.timeBegin, to: event.timeEnd });

  const loc = event.location;
  const address = loc ? formatAddress(loc) : "";
  const placeName = loc?.name || address;
  const hasPlace = !!loc && !!(loc.name || address);
  const hasCoords = !!loc && loc.latitude != null && loc.longitude != null;
  const mapHref = loc ? mapLinkFor(loc, address) : null;
  const icons = event.properties.filter((p) => p.property.icon);

  function addToCalendar() {
    const ics = buildEventIcs(event, {
      calendarName: feedName,
      timeZone: zone,
      labels: {
        features: t("events.export.ics.features"),
        targetGroups: t("events.export.ics.targetGroups"),
      },
    });
    downloadTextFile(ics, icsFileName(event.name));
  }

  return (
    <Modal
      size="wide"
      title={event.name}
      titleAside={
        icons.length > 0 && (
          <span
            className="ap-ico"
            style={{ fontSize: 20 }}
            role="img"
            aria-label={icons.map((p) => p.property.name).join(", ")}
          >
            {icons.map((p) => p.property.icon).join("")}
          </span>
        )
      }
      subtitle={feedName}
      closeLabel={t("feed.event.close")}
      onClose={onClose}
    >
      <dl className="ap-cols-2" style={{ margin: 0 }}>
        <div className="ap-datafield">
          <dt>{t("feed.event.date")}</dt>
          <dd>{dateText}</dd>
        </div>
        <div className="ap-datafield">
          <dt>{t("feed.event.time")}</dt>
          <dd>{timeText}</dd>
        </div>
      </dl>

      {hasPlace && (
        <section className="ap-stack ap-stack--sm" aria-labelledby="pe-place">
          <h2 className="t-label" id="pe-place">
            {t("feed.event.place")}
          </h2>
          <p className="t-body">
            {loc?.name ? (
              <>
                <strong>{loc.name}</strong>
                {address && (
                  <>
                    <br />
                    {address}
                  </>
                )}
              </>
            ) : (
              address
            )}
          </p>
          {hasCoords && (
            <MapBoundary
              fallback={<p className="t-sm t-muted">{t("feed.event.mapUnavailable")}</p>}
            >
              <Suspense fallback={<Skeleton style={{ height: 220, width: "100%" }} />}>
                <PublicEventMap
                  latitude={loc!.latitude!}
                  longitude={loc!.longitude!}
                  label={t("feed.event.mapLabel", { place: placeName })}
                />
              </Suspense>
            </MapBoundary>
          )}
          {mapHref && (
            <a
              className={buttonClass("secondary")}
              style={{ alignSelf: "flex-start" }}
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon glyph="external" size={18} />
              {t("feed.event.openMap")}
            </a>
          )}
        </section>
      )}

      {(event.properties.length > 0 ||
        event.features.length > 0 ||
        event.targetGroups.length > 0) && (
        <div className="ap-cols-3">
          {event.properties.length > 0 && (
            <section className="ap-stack ap-stack--sm" aria-labelledby="pe-props">
              <h2 className="t-label" id="pe-props">
                {t("feed.event.properties")}
              </h2>
              <ul className="ap-chips" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {event.properties.map(({ property }) => (
                  <li key={property.id} className="ap-chip ap-chip--static">
                    {property.icon && (
                      <span className="ap-ico" aria-hidden="true">
                        {property.icon}
                      </span>
                    )}
                    {property.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {event.features.length > 0 && (
            <section className="ap-stack ap-stack--sm" aria-labelledby="pe-feat">
              <h2 className="t-label" id="pe-feat">
                {t("feed.event.features")}
              </h2>
              <ul className="ap-chips" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {event.features.map(({ feature }) => (
                  <li key={feature.id} className="ap-chip ap-chip--static">
                    {feature.name}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {event.targetGroups.length > 0 && (
            <section className="ap-stack ap-stack--sm" aria-labelledby="pe-aud">
              <h2 className="t-label" id="pe-aud">
                {t("feed.event.audiences")}
              </h2>
              <ul className="cc-tags" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {event.targetGroups.map(({ targetGroup }) => (
                  <li key={targetGroup.id}>
                    <Tag tone={audienceTone(audiences.findIndex((g) => g.id === targetGroup.id))}>
                      {targetGroup.name}
                    </Tag>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <p className="t-sm t-muted">{t("feed.event.addToCalendarHint")}</p>
      <div className="ap-dialog-foot">
        <Button variant="secondary" onClick={onClose}>
          {t("feed.event.close")}
        </Button>
        <Button icon="calendar" onClick={addToCalendar}>
          {t("feed.event.addToCalendar")}
        </Button>
      </div>
    </Modal>
  );
}
