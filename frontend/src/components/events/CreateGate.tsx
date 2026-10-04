import { useTranslation } from "react-i18next";
import { Banner, Button, LinkButton, Skeleton } from "@/components/ui/shared";
import type { useEventPage } from "./useEventPage";
import type { CreateGate } from "./createGateState";

type EventPage = ReturnType<typeof useEventPage>;

/** Body of a create dialog while it is gated (title: `events.new.archived.title` when archived). */
export function CreateGateBody({
  gate,
  page,
  onClose,
}: {
  gate: Exclude<CreateGate, null>;
  page: EventPage;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (gate === "loading") return <ModalSkeleton label={t("events.form.loading")} />;
  if (gate === "failed") {
    return (
      <>
        <Banner
          tone="danger"
          title={t("calendar.error.title")}
          action={
            <Button variant="secondary" icon="refresh" onClick={page.reloadCalendar}>
              {t("calendar.error.retry")}
            </Button>
          }
        >
          {t("calendar.error.text")}
        </Banner>
        <div className="ap-dialog-foot">
          <Button onClick={onClose}>{t("events.form.close")}</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <p className="t-body">{t("events.new.archived.text")}</p>
      <div className="ap-dialog-foot">
        <LinkButton variant="secondary" icon="list" to={page.routes.list}>
          {t("events.new.archived.back")}
        </LinkButton>
        <Button onClick={onClose}>{t("events.form.close")}</Button>
      </div>
    </>
  );
}

/** Loading placeholder inside a dialog (announced, skeleton hidden from screen readers). */
export function ModalSkeleton({ label, tall }: { label: string; tall?: boolean }) {
  return (
    <div className="ap-stack" aria-busy="true">
      <p className="ap-sr" role="status">
        {label}
      </p>
      <div className="ap-stack" aria-hidden="true">
        <Skeleton style={{ display: "block", height: 40, width: "50%" }} />
        <Skeleton style={{ display: "block", height: tall ? 320 : 120 }} />
      </div>
    </div>
  );
}
