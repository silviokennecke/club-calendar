import { lazy, Suspense, useEffect, useRef } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatWeekdayDate } from "@/lib/events/format";
import { buildEventIcs, downloadTextFile, icsFileName } from "@/lib/events/ics";
import {
  feedAudiences,
  feedTimeZone,
  findPublicEvent,
  mapLinkFor,
  publicBackPath,
  type PublicFeedEvent,
} from "@/lib/feeds/public";
import { formatAddress } from "@/lib/types";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { useLocale } from "@/components/calendar/useLocale";
import { PublicShell } from "@/components/feed/PublicShell";
import { PublicError, PublicLoading } from "@/components/feed/PublicStates";
import { usePublicFeed } from "@/components/feed/usePublicFeed";
import { MapBoundary } from "@/components/locations/MapBoundary";
import {
  Button,
  EmptyState,
  Icon,
  LinkButton,
  Skeleton,
  Tag,
  buttonClass,
} from "@/components/ui/shared";

const PublicEventMap = lazy(() => import("@/components/feed/PublicEventMap"));

/**
 * Public event page (design: PublicEvent, PublicEventMobile): date and time, place with map and
 * text alternative, properties, features and audiences, "Zum Kalender hinzufügen" (one-event ICS
 * file made in the browser) and the way back. The feed endpoint has no single-event route, the
 * event is picked from the feed (shared query cache with the calendar page).
 */
export default function PublicEventPage() {
  const { t } = useTranslation();
  const { feedId, eventId } = useParams<{ feedId: string; eventId: string }>();
  const [params] = useSearchParams();
  const secret = params.get("secret") || undefined;
  const feed = usePublicFeed(feedId, secret);
  const location = useLocation();

  if (feed.isPending)
    return (
      <PublicShell noindex>
        <PublicLoading />
      </PublicShell>
    );
  if (!feed.data)
    return (
      <PublicShell noindex>
        <PublicError kind={feed.errorKind ?? "error"} onRetry={() => void feed.refetch()} />
      </PublicShell>
    );

  const event = findPublicEvent(feed.data.events, eventId);
  // The way back keeps month and filter (router state without the secret) and the secret of the address.
  const backTo = publicBackPath(
    feedId!,
    secret,
    (location.state as { from?: string } | null)?.from,
    { date: event?.date.slice(0, 10) },
  );

  if (!event) {
    return (
      <PublicShell noindex>
        <div style={{ padding: "var(--space-8) 0" }}>
          <EmptyState
            headingLevel="h1"
            title={t("feed.event.notFound.title")}
            text={t("feed.event.notFound.text")}
            actions={
              <LinkButton icon="arrow-left" to={backTo}>
                {t("feed.event.back")}
              </LinkButton>
            }
          />
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell title={`${event.name} – ${feed.data.feed.name}`} noindex={!!secret}>
      <EventDetail
        event={event}
        feedName={feed.data.feed.name}
        zone={feedTimeZone(feed.data.events)}
        audiences={feedAudiences(feed.data.events)}
        backTo={backTo}
      />
    </PublicShell>
  );
}

interface EventDetailProps {
  event: PublicFeedEvent;
  feedName: string;
  zone: string | null;
  audiences: { id: string; name: string }[];
  backTo: string;
}

function EventDetail({ event, feedName, zone, audiences, backTo }: EventDetailProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The calendar item that opened this page is gone: start at the event's title.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [event.id]);
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
    <article
      className="ap-stack ap-stack--lg"
      style={{ padding: "var(--space-6) 0 var(--space-4)" }}
    >
      <div>
        <LinkButton variant="ghost" icon="arrow-left" to={backTo} state={{ back: true }}>
          {t("feed.event.back")}
        </LinkButton>
      </div>

      <header className="ap-stack ap-stack--sm">
        <div className="ap-row" style={{ gap: "var(--space-2)" }}>
          <h1 className="t-h1" ref={headingRef} tabIndex={-1}>
            {event.name}
          </h1>
          {icons.length > 0 && (
            <span
              className="ap-ico"
              style={{ fontSize: 24 }}
              role="img"
              aria-label={icons.map((p) => p.property.name).join(", ")}
            >
              {icons.map((p) => p.property.icon).join("")}
            </span>
          )}
        </div>
        <p className="t-sm t-muted">{feedName}</p>
      </header>

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

      <div className="ap-stack ap-stack--sm">
        <div>
          <Button icon="calendar" onClick={addToCalendar}>
            {t("feed.event.addToCalendar")}
          </Button>
        </div>
        <p className="t-sm t-muted">{t("feed.event.addToCalendarHint")}</p>
      </div>
    </article>
  );
}
