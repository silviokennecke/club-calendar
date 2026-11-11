import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatWeekdayDate } from "@/lib/events/format";
import { downloadBlob, icsFileName } from "@/lib/events/ics";
import { todayIn } from "@/lib/calendar";
import {
  fetchPublicEventIcs,
  mapLinkFor,
  publicFeedPath,
  type PublicFeedEvent,
  type PublicFeedHeader,
} from "@/lib/feeds/public";
import { API_URL } from "@/lib/apiUrl";
import { formatAddress } from "@/lib/types";
import { useModalNav } from "@/lib/useModalNav";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { useLocale } from "@/components/calendar/useLocale";
import { ModalSkeleton } from "@/components/events/CreateGate";
import { usePublicEvent, usePublicFeed } from "@/components/feed/usePublicFeed";
import { usePublicHead } from "@/components/feed/usePublicHead";
import { Button, Icon, Modal, Tag, buttonClass, toast } from "@/components/ui/shared";
import { sortTargetGroupRefs } from "@/lib/sortByName";

/**
 * Static map image of a location from the backend (`/api/map/image/location/{id}`, fixed 800x288,
 * public). No mapbox-gl on public pages, so anonymous visitors cause at most one cached static image
 * request. `v` (the location's `updatedAt`) busts the cache after a change.
 */
function PublicLocationImage({
  id,
  version,
  label,
}: {
  id: string;
  version?: number;
  label: string;
}) {
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="t-sm t-muted">{t("feed.event.mapUnavailable")}</p>;
  const query = version != null ? `?v=${encodeURIComponent(String(version))}` : "";
  return (
    <img
      src={`${API_URL}/api/map/image/location/${encodeURIComponent(id)}${query}`}
      alt={label}
      width={800}
      height={288}
      loading="lazy"
      decoding="async"
      className="ap-map object-cover"
      style={{ height: "auto", aspectRatio: "800 / 288" }}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Public event details (design: PublicEvent, PublicEventMobile) as a dialog above the public feed;
 * the URL /feed/:feedId/events/:eventId stays shareable (a direct call shows the feed below, at the
 * event's month). Date and time, place with map and text alternative, properties, features and
 * audiences, "Zum Kalender hinzufügen" (one-event ICS file from the backend). The event comes from
 * the single-event endpoint (the background feed loads its month on its own). A 404 there is an
 * unknown feed or an unknown event: a small feed request tells them apart. The router state keeps the
 * way back without the secret; the secret comes from the address.
 */
export default function PublicEventModal() {
  const { t } = useTranslation();
  const { feedId = "", eventId } = useParams<{ feedId: string; eventId: string }>();
  const [params] = useSearchParams();
  const secret = params.get("secret") || undefined;
  const one = usePublicEvent(feedId, eventId, secret);
  const nav = useModalNav();
  // Only after a 404: does the feed exist (then the event is unknown) or not?
  const probeDay = todayIn(null);
  const feedProbe = usePublicFeed(one.errorKind === "notFound" ? feedId : undefined, secret, {
    from: probeDay,
    to: probeDay,
  });

  const event = one.data?.event;
  const header = one.data?.feed ?? feedProbe.data?.feed;
  const eventDate = event?.date.slice(0, 10);
  const { hasStoredBackground, setBackground } = nav;
  // A shared link: show the feed at the event's month below the dialog (stored without the secret).
  useEffect(() => {
    if (!eventDate || hasStoredBackground) return;
    setBackground(publicFeedPath(feedId, undefined, { date: eventDate }));
  }, [eventDate, hasStoredBackground, setBackground, feedId]);

  const title = event
    ? `${event.name} – ${header!.name}`
    : header
      ? t("feed.event.notFound.title")
      : t("feed.brand");
  // Only an event of an indexable feed (PUBLIC + search engine option) may be indexed; club
  // internal and private feeds and states without an event are noindex.
  usePublicHead({ title, indexable: !!event && header?.indexable === true });

  const close = t("feed.event.close");

  if (one.isPending || (one.errorKind === "notFound" && feedProbe.isPending)) {
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

  if (!one.data || !event) {
    // The feed failed (private, unknown, load error) or the event is unknown / a draft.
    const kind =
      one.errorKind === "notFound"
        ? feedProbe.data
          ? "eventNotFound"
          : (feedProbe.errorKind ?? "error")
        : (one.errorKind ?? "error");
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
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                void one.refetch();
                if (one.errorKind === "notFound") void feedProbe.refetch();
              }}
            >
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
      feed={one.data.feed}
      onAddToCalendar={async () =>
        downloadBlob(await fetchPublicEventIcs(feedId, event.id, secret), icsFileName(event.name))
      }
      onClose={nav.close}
    />
  );
}

interface EventDetailProps {
  event: PublicFeedEvent;
  feed: PublicFeedHeader;
  /** Offers "Zum Kalender hinzufügen"; a rejected promise shows the error toast. */
  onAddToCalendar?: () => Promise<void>;
  onClose: () => void;
}

/** Details dialog of a feed event; also used by the personal calendar of "Mein Verein". */
export function EventDetail({ event, feed, onAddToCalendar, onClose }: EventDetailProps) {
  const audiences = feed.audiences;
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

  async function addToCalendar() {
    try {
      await onAddToCalendar?.();
    } catch {
      toast.error(t("feed.event.downloadFailed"));
    }
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
      subtitle={t("feed.event.subtitle", { club: feed.clubName, feed: feed.name })}
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

      {event.note && (
        <section className="ap-stack ap-stack--sm" aria-labelledby="pe-note">
          <h2 className="t-label" id="pe-note">
            {t("feed.event.note")}
          </h2>
          <p className="t-body" style={{ whiteSpace: "pre-line" }}>
            {event.note}
          </p>
        </section>
      )}

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
            <PublicLocationImage
              id={loc!.id}
              version={loc!.updatedAt}
              label={t("feed.event.mapLabel", { place: placeName })}
            />
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
                {sortTargetGroupRefs(event.targetGroups).map(({ targetGroup }) => (
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

      {onAddToCalendar && <p className="t-sm t-muted">{t("feed.event.addToCalendarHint")}</p>}
      <div className="ap-dialog-foot">
        <Button variant="secondary" onClick={onClose}>
          {t("feed.event.close")}
        </Button>
        {onAddToCalendar && (
          <Button icon="calendar" onClick={addToCalendar}>
            {t("feed.event.addToCalendar")}
          </Button>
        )}
      </div>
    </Modal>
  );
}
