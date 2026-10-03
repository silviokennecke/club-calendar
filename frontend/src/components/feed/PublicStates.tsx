import { useTranslation } from "react-i18next";
import { Banner, Button, EmptyState, Skeleton } from "@/components/ui/shared";
import type { PublicFeedErrorKind } from "@/lib/feeds/public";

const SEVEN = Array.from({ length: 14 }, (_, i) => i);

/** Loading placeholder (design: PublicStates "Laden"). */
export function PublicLoading() {
  const { t } = useTranslation();
  return (
    <div className="ap-stack" aria-busy="true" style={{ paddingTop: "var(--space-6)" }}>
      <h1 className="ap-sr">{t("feed.brand")}</h1>
      <p className="ap-sr" role="status">
        {t("feed.loading")}
      </p>
      <div className="ap-stack" aria-hidden="true">
        <Skeleton style={{ height: 32, width: "60%" }} />
        <Skeleton style={{ height: 20, width: "35%" }} />
        <div className="grid grid-cols-7 gap-2">
          {SEVEN.map((i) => (
            <Skeleton key={i} style={{ height: 56 }} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface PublicErrorProps {
  kind: PublicFeedErrorKind;
  onRetry: () => void;
}

/**
 * The feed cannot be shown (design: PublicStates a–c): private (secret missing or wrong),
 * not found / not published (also archived calendars: the API answers 404), load error.
 * The title is the page's h1.
 */
export function PublicError({ kind, onRetry }: PublicErrorProps) {
  const { t } = useTranslation();
  if (kind === "private" || kind === "notFound") {
    const key = kind === "private" ? "private" : "notFound";
    return (
      <div style={{ padding: "var(--space-8) 0" }}>
        <EmptyState
          headingLevel="h1"
          icon={kind === "private" ? "lock" : "calendar"}
          title={t(`feed.states.${key}.title`)}
          text={t(`feed.states.${key}.text`)}
        />
      </div>
    );
  }
  return (
    <div className="ap-stack" style={{ padding: "var(--space-8) 0" }}>
      <Banner tone="danger" title={t("feed.states.error.banner")}>
        {t("feed.states.error.bannerText")}
      </Banner>
      <EmptyState
        headingLevel="h1"
        icon="refresh"
        title={t("feed.states.error.title")}
        text={t("feed.states.error.text")}
        actions={
          <Button icon="refresh" onClick={onRetry}>
            {t("feed.states.error.retry")}
          </Button>
        }
      />
    </div>
  );
}
