import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMyEvent } from "@/lib/club/memberApi";
import { myClubPath } from "@/lib/club/myClub";
import { useModalNav } from "@/lib/useModalNav";
import { ModalSkeleton } from "@/components/events/CreateGate";
import { Button, Modal } from "@/components/ui/shared";
import { EventDetail } from "./PublicEventModal";

/**
 * Event details from the personal calendar of "Mein Verein" as a dialog above it. Shares the dialog
 * body with the public feed; the one-event ICS belongs to a feed address, so it is not offered here.
 */
export default function MyEventModal() {
  const { t } = useTranslation();
  const { clubId, eventId } = useParams<{ clubId: string; eventId: string }>();
  const one = useMyEvent(clubId, eventId);
  const nav = useModalNav();
  const { hasStoredBackground, setBackground } = nav;
  const eventDate = one.data?.event.date.slice(0, 10);
  // A reload or shared link: show the event's month below the dialog.
  useEffect(() => {
    if (!eventDate || hasStoredBackground || !clubId) return;
    setBackground(`${myClubPath(clubId)}?date=${eventDate}`);
  }, [eventDate, hasStoredBackground, setBackground, clubId]);

  const close = t("feed.event.close");
  if (one.isPending) {
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
  if (!one.data) {
    return (
      <Modal
        size="wide"
        title={t("feed.event.notFound.title")}
        closeLabel={close}
        onClose={nav.close}
      >
        <p className="t-body">{t("feed.event.notFound.text")}</p>
        <div className="ap-dialog-foot">
          <Button onClick={nav.close}>{t("myClub.calendar.backToCalendar")}</Button>
        </div>
      </Modal>
    );
  }
  return <EventDetail event={one.data.event} feed={one.data.feed} onClose={nav.close} />;
}
