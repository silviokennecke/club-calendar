import { useState, useEffect, useId } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  eventToItem,
  formatMonthTitle,
  stepAnchor,
  todayIn,
  yearMonthOf,
  type CalItem,
} from "@/lib/calendar";
import { useIsMobile } from "@/lib/useMediaQuery";
import { MonthView } from "@/components/calendar/MonthView";
import { MonthNav } from "@/components/calendar/MonthNav";
import { useLocale } from "@/components/calendar/useLocale";
import { Button } from "@/components/ui/button";
import {
  TagBadge,
  FilterPillGroup,
  FullPageLoader,
  FullPageError,
  LangSwitch,
} from "@/components/ui/shared";
import { Calendar, Download, X, MapPin, Clock, Tag, Users, Sparkles } from "lucide-react";
import { formatAddress } from "@/lib/types";

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface FeedEvent {
  id: number;
  name: string;
  date: string;
  dateEnd?: string | null;
  timeBegin: string;
  timeEnd: string;
  isAllDay?: boolean;
  location?: {
    id: string;
    name?: string | null;
    street?: string | null;
    zip?: string | null;
    city?: string | null;
    country?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    updatedAt: number;
  } | null;
  properties: { property: { id: number; name: string; icon: string | null } }[];
  features: { feature: { id: number; name: string } }[];
  targetGroups: { targetGroup: { id: number; name: string } }[];
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function EventDetail({ ev, onClose }: { ev: FeedEvent; onClose: () => void }) {
  const { t } = useTranslation();
  const startDate = formatDate(ev.date);
  const endDate =
    ev.dateEnd && ev.dateEnd.slice(0, 10) !== ev.date.slice(0, 10) ? formatDate(ev.dateEnd) : null;

  const iconPrefix = ev.properties
    .map((p) => p.property.icon)
    .filter(Boolean)
    .join("");
  const hasMap = ev.location?.latitude != null && ev.location?.longitude != null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 rounded-full bg-slate-100 p-1.5 text-slate-500 transition-colors hover:bg-slate-200"
        >
          <X className="h-4 w-4" />
        </button>

        {hasMap && (
          <div className="h-36 w-full overflow-hidden bg-slate-100">
            <img
              src={`${BASE}/api/map/image/location/${ev.location!.id}?v=${ev.location!.updatedAt}`}
              alt={t("feed.locationMapAlt")}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="space-y-4 p-5">
          <div>
            {iconPrefix && <span className="mr-2 text-2xl">{iconPrefix}</span>}
            <h2 className="inline text-lg font-bold text-slate-900">{ev.name}</h2>
          </div>

          <div className="flex items-start gap-2.5 text-sm text-slate-700">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <div>
              {ev.isAllDay ? (
                <span>
                  {endDate ? `${startDate} – ${endDate}` : startDate}
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                    {t("feed.allDay")}
                  </span>
                </span>
              ) : (
                <span>
                  {endDate
                    ? `${startDate} ${ev.timeBegin} – ${endDate} ${ev.timeEnd}`
                    : `${startDate}, ${ev.timeBegin} – ${ev.timeEnd}`}
                </span>
              )}
            </div>
          </div>

          {ev.location && (
            <div className="flex items-start gap-2.5 text-sm text-slate-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                {ev.location.name && <p className="font-medium">{ev.location.name}</p>}
                {formatAddress(ev.location) && (
                  <p className={ev.location.name ? "text-xs text-slate-500" : ""}>
                    {formatAddress(ev.location)}
                  </p>
                )}
                {ev.location.latitude != null && (
                  <a
                    href={`https://maps.google.com/?q=${ev.location.latitude},${ev.location.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-block text-xs text-blue-600 hover:underline"
                  >
                    {t("feed.openInMaps")}
                  </a>
                )}
              </div>
            </div>
          )}

          {ev.targetGroups.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex flex-wrap gap-1">
                {ev.targetGroups.map((t) => (
                  <TagBadge key={t.targetGroup.id} label={t.targetGroup.name} tone="adult" />
                ))}
              </div>
            </div>
          )}

          {ev.properties.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Tag className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex flex-wrap gap-1">
                {ev.properties.map((p) => (
                  <TagBadge
                    key={p.property.id}
                    label={p.property.name}
                    icon={p.property.icon}
                    tone="brand"
                  />
                ))}
              </div>
            </div>
          )}

          {ev.features.length > 0 && (
            <div className="flex items-start gap-2.5">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div className="flex flex-wrap gap-1">
                {ev.features.map((f) => (
                  <TagBadge key={f.feature.id} label={f.feature.name} tone="neutral" />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FeedPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const isMobile = useIsMobile();
  const titleId = `feed-month-${useId().replace(/:/g, "")}`;
  const today = todayIn();
  const [anchor, setAnchor] = useState(today);
  const [panelOpen, setPanelOpen] = useState(false);
  const { feedId } = useParams<{ feedId: string }>();
  const [searchParams] = useSearchParams();
  const secret = searchParams.get("secret") ?? undefined;
  const [feedName, setFeedName] = useState("");
  const [allEvents, setAllEvents] = useState<FeedEvent[]>([]);
  const [allGroups, setAllGroups] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<FeedEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = new URL(`${BASE}/api/feed/${feedId}/events`);
    if (secret) url.searchParams.set("secret", secret);
    fetch(url.toString())
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 403) setError("feed.privateError");
          else if (res.status === 404) setError("feed.notFoundError");
          else setError("feed.loadError");
          return;
        }
        const data = (await res.json()) as { feed: { name: string }; events: FeedEvent[] };
        setFeedName(data.feed.name);
        setAllEvents(data.events);
        const tgMap = new Map<number, string>();
        data.events.forEach((ev) =>
          ev.targetGroups.forEach((t) => tgMap.set(t.targetGroup.id, t.targetGroup.name)),
        );
        setAllGroups(Array.from(tgMap.entries()).map(([id, name]) => ({ id, name })));
      })
      .catch(() => setError("feed.loadError"))
      .finally(() => setLoading(false));
  }, [feedId, secret]);

  function toggleGroup(id: number) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const filtered =
    selected.length === 0
      ? allEvents
      : allEvents.filter((ev) => ev.targetGroups.some((t) => selected.includes(t.targetGroup.id)));

  function buildUrl(proto: string) {
    const url = new URL(`${BASE.replace(/^https?:/, proto + ":")}/api/feed/${feedId}/ics`);
    if (secret) url.searchParams.set("secret", secret);
    if (selected.length > 0) url.searchParams.set("targetGroupIds", selected.join(","));
    return url.toString();
  }

  const items: CalItem<FeedEvent>[] = filtered.map((ev) => eventToItem(ev));

  function step(direction: -1 | 1) {
    setPanelOpen(false);
    setAnchor((a) => stepAnchor("month", a, direction));
  }

  if (loading) return <FullPageLoader message={t("feed.loading")} />;
  if (error)
    return (
      <FullPageError message={t(error as Parameters<typeof t>[0])}>
        <Calendar className="mx-auto mb-3 h-10 w-10 text-slate-300" />
      </FullPageError>
    );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-blue-600" />
                <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  {t("feed.publicCalendar")}
                </span>
              </div>
              <h1 className="text-xl font-bold text-slate-900">{feedName}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LangSwitch />
              <a href={buildUrl("webcal")}>
                <Button size="sm" className="gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  {t("feed.subscribe")}
                </Button>
              </a>
              <a href={buildUrl("http")} download>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  ICS
                </Button>
              </a>
            </div>
          </div>

          {allGroups.length > 1 && (
            <FilterPillGroup
              label={t("feed.filter")}
              items={allGroups.map((tg) => ({ id: String(tg.id), label: tg.name }))}
              selected={selected.map(String)}
              onChange={(id) => toggleGroup(Number(id))}
              onClearAll={() => setSelected([])}
              clearAllLabel={t("feed.allGroups")}
              className="mt-4"
            />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="ap-panel">
          <div className="ap-stack">
            <MonthNav
              as="h2"
              title={formatMonthTitle(yearMonthOf(anchor), locale)}
              titleId={titleId}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onToday={() => {
                setPanelOpen(false);
                setAnchor(today);
              }}
            />
            <MonthView
              month={yearMonthOf(anchor)}
              weekStart={1}
              items={items}
              today={today}
              activeDate={anchor}
              selectedDate={anchor}
              panelOpen={panelOpen}
              compact={isMobile}
              labelledBy={titleId}
              onMoveFocus={setAnchor}
              onSelectDay={(date) => {
                setAnchor(date);
                setPanelOpen(true);
              }}
              onClosePanel={() => setPanelOpen(false)}
              onOpenItem={(item) => setSelectedEvent(item.source as FeedEvent)}
              placeOf={(item) => (item.source as FeedEvent).location?.name}
              showHolidayLegend={false}
            />
          </div>
        </div>
        {selected.length > 0 && (
          <p className="mt-3 text-center text-xs text-slate-400">
            {t("feed.showingCount", { filtered: filtered.length, total: allEvents.length })}
          </p>
        )}
        <p className="mt-2 text-center text-xs text-slate-400">{t("feed.clickForDetails")}</p>
      </div>

      {selectedEvent && <EventDetail ev={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
