import { useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";
import { buttonClass } from "./buttonClass";
import { Field, TextInput } from "./Field";

interface ConfirmDialogProps {
  /** Controlled open state (omit together with onOpenChange and pass `trigger` instead). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the dialog (rendered as the dialog trigger). */
  trigger?: ReactElement;
  title: ReactNode;
  description: ReactNode;
  /** The scope of the consequences, e.g. "Löscht 14 Termine und 2 Feeds." */
  consequence?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  /** danger = destructive (default), primary = non-destructive confirmation. */
  tone?: "danger" | "primary";
  icon?: Glyph;
  /** If set, the user must type exactly this text to enable the confirm button. */
  requireText?: string;
  requireLabel?: ReactNode;
  /** May return a promise; the dialog shows a busy state and closes when it resolves. */
  onConfirm: () => void | Promise<void>;
  /**
   * Second way to confirm next to the main action (e.g. "Nur diesen Termin" vs. "Alle Termine der
   * Reihe"); shown between cancel and confirm, same busy handling.
   */
  alternative?: {
    label: ReactNode;
    onConfirm: () => void | Promise<void>;
  };
}

/** Confirmation for destructive actions; always states the consequences. */
export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  consequence,
  confirmLabel,
  cancelLabel,
  tone = "danger",
  icon,
  requireText,
  requireLabel,
  onConfirm,
  alternative,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const [internalOpen, setInternalOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<false | "confirm" | "alternative">(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const uid = useId().replace(/:/g, "");
  const open = openProp ?? internalOpen;

  function setOpen(next: boolean) {
    if (openProp === undefined) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) setTyped("");
  }

  const blocked = !!requireText && typed.trim() !== requireText;

  async function run(which: "confirm" | "alternative", action: () => void | Promise<void>) {
    if (blocked || busy) return;
    setBusy(which);
    try {
      await action();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  const spinner = (
    <Icon glyph="loader" size={18} className="animate-spin motion-reduce:animate-none" />
  );

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={(next) => setOpen(next)}>
      {trigger && <AlertDialogPrimitive.Trigger render={trigger} />}
      <AlertDialogPrimitive.Portal>
        {/* forceRender: also dim a dialog below (delete / unsaved above the event dialog). */}
        <AlertDialogPrimitive.Backdrop
          forceRender
          className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 bg-scrim fixed inset-0 isolate z-50 duration-100"
        />
        <AlertDialogPrimitive.Popup
          initialFocus={cancelRef}
          className="ap-dialog fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none max-[720px]:top-auto max-[720px]:bottom-0 max-[720px]:translate-y-0 max-[720px]:rounded-b-none"
        >
          <span className={cn("ap-dialog-icon", tone === "primary" && "ap-dialog-icon--brand")}>
            <Icon glyph={icon ?? (tone === "primary" ? "info" : "trash")} size={24} />
          </span>
          <AlertDialogPrimitive.Title className="t-h2">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="t-body">
            {description}
          </AlertDialogPrimitive.Description>
          {consequence && <p className="ap-consequence">{consequence}</p>}
          {requireText && (
            <Field
              id={`confirm-${uid}`}
              label={requireLabel ?? t("ui.confirm.requireLabel", { text: requireText })}
            >
              <TextInput
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
              />
            </Field>
          )}
          <div className="ap-dialog-foot">
            <AlertDialogPrimitive.Close
              ref={cancelRef}
              className={buttonClass("secondary")}
              disabled={!!busy}
            >
              {cancelLabel ?? t("common.cancel")}
            </AlertDialogPrimitive.Close>
            {alternative && (
              <button
                type="button"
                className={buttonClass(tone === "primary" ? "secondary" : "danger")}
                disabled={blocked || !!busy}
                aria-busy={busy === "alternative" || undefined}
                onClick={() => run("alternative", alternative.onConfirm)}
              >
                {busy === "alternative" && spinner}
                {alternative.label}
              </button>
            )}
            <button
              type="button"
              className={buttonClass(tone === "primary" ? "primary" : "danger-solid")}
              disabled={blocked || !!busy}
              aria-busy={busy === "confirm" || undefined}
              onClick={() => run("confirm", onConfirm)}
            >
              {busy === "confirm" && spinner}
              {confirmLabel}
            </button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
