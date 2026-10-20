import { Link, useLocation } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";
import { openModalState } from "@/lib/modalRoutes";
import { consentCheckboxId, externalLinkProps, legalPath, type LegalType } from "@/lib/legal";

export interface ConsentItem {
  type: LegalType;
  id: string;
  /** External document: the label opens it in a new tab (leaving would lose the entered state). */
  url?: string | null;
}

interface ConsentCheckboxesProps {
  items: ConsentItem[];
  /** Ids of the accepted documents. */
  checked: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
  /** Error per document id. */
  errors?: Record<string, string | undefined>;
  /** Prefix of the checkbox ids (`<prefix>-<type>`). */
  idPrefix: string;
  disabled?: boolean;
  /**
   * Opens a document inside the surrounding (non-routed) dialog instead of navigating to the routed
   * legal modal (stacking a routed modal on a dialog is not supported).
   */
  onOpenDocument?: (item: ConsentItem) => void;
}

/**
 * One checkbox per consent document; the label links to the document (routed modal above the current
 * page, which stays mounted, so entered form values survive).
 */
export function ConsentCheckboxes({
  items,
  checked,
  onToggle,
  errors = {},
  idPrefix,
  disabled,
  onOpenDocument,
}: ConsentCheckboxesProps) {
  const { t } = useTranslation();
  const location = useLocation();
  return (
    <div className="ap-stack ap-stack--sm">
      {items.map((item) => {
        const id = consentCheckboxId(idPrefix, item.type);
        const error = errors[item.id];
        return (
          <div key={item.id}>
            <label className="ap-check">
              <input
                type="checkbox"
                id={id}
                checked={checked.has(item.id)}
                disabled={disabled}
                aria-required="true"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                onChange={(e) => onToggle(item.id, e.target.checked)}
              />
              <span>
                <Trans
                  i18nKey={`consent.accept.${item.type}`}
                  components={{
                    doc: item.url ? (
                      <a {...externalLinkProps(item.url, true)} className="ap-link" />
                    ) : onOpenDocument ? (
                      <button
                        type="button"
                        className="ap-link"
                        onClick={() => onOpenDocument(item)}
                      />
                    ) : (
                      <Link
                        to={legalPath(item.type)}
                        state={openModalState(location)}
                        className="ap-link"
                      />
                    ),
                  }}
                />{" "}
                <span className="font-normal">{t("ui.field.required")}</span>
              </span>
            </label>
            {error && (
              <span id={`${id}-error`} className="cc-hint cc-hint--error">
                {error}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
