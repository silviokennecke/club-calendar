import type { FormEvent, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { DialogFrame } from "./Modal";

interface FormDialogProps {
  open: boolean;
  /** Called for Escape, a click on the backdrop and `onOpenChange(false)` from the footer. */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Short explanation for screen readers (the visible text is the form itself). */
  description: ReactNode;
  /** Fields of the form (error summary first, then the fields). */
  children: ReactNode;
  /** Footer buttons; the primary one is `type="submit"`. */
  actions: ReactNode;
  onSubmit: () => void;
  wide?: boolean;
  /** Where focus goes when the dialog closes (default: the element that opened it). */
  finalFocus?: () => HTMLElement | null;
}

/**
 * Small dialog with a form (design: `.ap-dialog` with an h2 title): built on the shared
 * `DialogFrame` (focus trap, Escape closes, focus returns to the trigger, bottom sheet on phones);
 * Enter submits. For destructive confirmations use `ConfirmDialog`, for routed dialogs `Modal`.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  onSubmit,
  wide,
  finalFocus,
}: FormDialogProps) {
  return (
    <DialogFrame
      open={open}
      onOpenChange={onOpenChange}
      className={wide ? "ap-dialog--wide" : undefined}
      finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}
    >
      <DialogPrimitive.Title className="t-h2">{title}</DialogPrimitive.Title>
      <DialogPrimitive.Description className="ap-sr">{description}</DialogPrimitive.Description>
      <form
        className="ap-form"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          // React bubbles through portals: keep a dialog opened from inside a form from submitting it.
          e.stopPropagation();
          onSubmit();
        }}
      >
        {children}
        <div className="ap-dialog-foot">{actions}</div>
      </form>
    </DialogFrame>
  );
}
