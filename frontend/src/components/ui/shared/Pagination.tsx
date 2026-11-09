import { useTranslation } from "react-i18next";
import { Button } from "./Button";

interface Props {
  page: number;
  pageCount: number;
  /** Number of all entries (shown next to the page counter). */
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

/** Previous / next with "Page X of Y" and the total; renders nothing for a single page. */
export function Pagination({ page, pageCount, total, onPageChange, disabled }: Props) {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;
  return (
    <nav
      className="ap-row"
      style={{ gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}
      aria-label={t("ui.pagination.label")}
    >
      <p className="t-small" role="status">
        {t("ui.pagination.status", { page, pages: pageCount, count: total })}
      </p>
      <span className="ap-row" style={{ gap: 8 }}>
        <Button
          variant="secondary"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("ui.pagination.prev")}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled || page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          {t("ui.pagination.next")}
        </Button>
      </span>
    </nav>
  );
}
