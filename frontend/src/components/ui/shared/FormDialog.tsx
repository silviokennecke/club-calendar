import type { FormEvent, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
 * Dialog with a form (design: `.ap-dialog` as `<form role="dialog">`): focus trap, Escape closes,
 * Enter submits, focus returns to the trigger. For destructive confirmations use `ConfirmDialog`.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-scrim supports-backdrop-filter:backdrop-blur-none" />
        <DialogPrimitive.Popup
          finalFocus={finalFocus ? () => finalFocus() ?? true : undefined}
          className={cn(
            "ap-dialog fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none max-[720px]:top-auto max-[720px]:bottom-0 max-[720px]:translate-y-0 max-[720px]:rounded-b-none",
            wide && "ap-dialog--wide",
          )}
        >
          <DialogPrimitive.Title className="t-h2">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="ap-sr">{description}</DialogPrimitive.Description>
          <form
            className="ap-form"
            noValidate
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {children}
            <div className="ap-dialog-foot">{actions}</div>
          </form>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
