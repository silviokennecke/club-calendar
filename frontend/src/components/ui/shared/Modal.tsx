/* eslint-disable react-refresh/only-export-components -- component + its focus hook */
import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Outlet } from "react-router-dom";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";
import { IconButton } from "./Button";
import { FullPageLoader } from "./PageLoader";

type FocusTarget =
  boolean | RefObject<HTMLElement | null> | (() => HTMLElement | boolean | null | void);

interface DialogFrameProps {
  open: boolean;
  /** Escape, a press outside the dialog and `Dialog.Close` call this with `false`. */
  onOpenChange: (open: boolean) => void;
  /** Extra classes of the `.ap-dialog` (size: `ap-dialog--wide`, `--xl`, `--form`). */
  className?: string;
  initialFocus?: FocusTarget;
  /** Where focus goes when the dialog closes (default: the element focused before it opened). */
  finalFocus?: FocusTarget;
  /** The dialog element itself received focus (e.g. the focused element of a step was removed). */
  onSelfFocus?: () => void;
  children: ReactNode;
}

/**
 * Dialog shell of all app dialogs (design: `.ap-scrim` > `.ap-dialog`): Base UI modal dialog with
 * focus trap, scroll lock, Escape, outside press, everything else hidden from assistive technology,
 * focus return. Centered on wide screens, bottom sheet below 720px (CSS). Title / description go
 * in as `Dialog.Title` / `Dialog.Description` (they label the dialog).
 */
export function DialogFrame({
  open,
  onOpenChange,
  className,
  initialFocus,
  finalFocus,
  onSelfFocus,
  children,
}: DialogFrameProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Viewport className="ap-scrim">
          <DialogPrimitive.Popup
            initialFocus={initialFocus}
            finalFocus={finalFocus}
            aria-modal="true"
            onFocus={
              onSelfFocus
                ? (e) => {
                    if (e.target === e.currentTarget) onSelfFocus();
                  }
                : undefined
            }
            className={cn("ap-dialog outline-none", className)}
          >
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type ModalSize = "default" | "wide" | "xl";

interface ModalFrameContext {
  setVariant: (size: ModalSize, form: boolean) => void;
  closeRef: { current: () => void };
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** Id of the field the current step starts in (`useModalInitialFocus`), else the heading. */
  startFieldRef: { current: string | null };
}

const FrameContext = createContext<ModalFrameContext | null>(null);

/**
 * A dialog that stays open across the steps of a flow (route layout of the routed modals):
 * the steps render `<Modal>` inside it and swap head and body, the focus trap, the scroll lock
 * and the focus return to the opening element stay. Renders `children` or the route `<Outlet>`.
 */
export function ModalFrame({ children }: { children?: ReactNode }) {
  const [variant, setVariantState] = useState<{ size: ModalSize; form: boolean }>({
    size: "default",
    form: false,
  });
  const closeRef = useRef<() => void>(() => {});
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startFieldRef = useRef<string | null>(null);
  const ctx = useMemo<ModalFrameContext>(
    () => ({
      setVariant: (size, form) =>
        setVariantState((v) => (v.size === size && v.form === form ? v : { size, form })),
      closeRef,
      headingRef,
      startFieldRef,
    }),
    [],
  );
  return (
    <DialogFrame
      open
      onOpenChange={(next) => {
        if (!next) closeRef.current();
      }}
      initialFocus={headingRef}
      // Focus fell back to the dialog (a step replaced the focused element): start again.
      onSelfFocus={() => {
        const field = startFieldRef.current && document.getElementById(startFieldRef.current);
        (field || headingRef.current)?.focus({ preventScroll: true });
      }}
      className={cn(
        variant.size === "wide" && "ap-dialog--wide",
        variant.size === "xl" && "ap-dialog--xl",
        variant.form && "ap-dialog--form",
      )}
    >
      <FrameContext.Provider value={ctx}>
        {/* The dialog's content renders in Base UI's portal after a layout effect, outside the router's
            transition: a lazy dialog chunk that is still loading suspends here (loading state in the
            dialog), not in the page-level boundary (which would hide the whole page). */}
        <Suspense fallback={<ModalLoading />}>{children ?? <Outlet />}</Suspense>
      </FrameContext.Provider>
    </DialogFrame>
  );
}

/** Loading state inside a routed dialog; moves focus to the step's start once the content is there. */
function ModalLoading() {
  const ctx = useContext(FrameContext);
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const fieldId = ctx?.startFieldRef.current;
        const target = (fieldId && document.getElementById(fieldId)) || ctx?.headingRef.current;
        const active = document.activeElement;
        const onFrame = !active || active === document.body || active.matches(".ap-dialog");
        if (target && onFrame) target.focus({ preventScroll: true });
      });
    },
    [ctx],
  );
  return <FullPageLoader className="min-h-40" />;
}

export interface ModalProps {
  /** The dialog's h1 (labels the dialog). */
  title: ReactNode;
  /** Next to the title (e.g. property symbols). */
  titleAside?: ReactNode;
  /** Text below the title (describes the dialog). */
  subtitle?: ReactNode;
  /** Below the subtitle (e.g. a StatusBadge). */
  headExtra?: ReactNode;
  /** Accessible name of the x button; names the consequence ("Schließen, Termin verwerfen"). */
  closeLabel: string;
  /** Close button, Escape and a press outside; guard unsaved changes here. */
  onClose: () => void;
  /** default 520px, wide 760px, xl 880px (design: ap-dialog, --wide, --xl). */
  size?: ModalSize;
  /** Form layout: borderless sections with dividers, sticky footer (design: ap-dialog--form). */
  form?: boolean;
  /** Content is loading (aria-busy on the body). */
  busy?: boolean;
  children: ReactNode;
}

/**
 * Head (h1, subtitle, close button) and body of a dialog. Inside a `ModalFrame` it becomes the
 * current step of that dialog, on its own it opens its own dialog. Focus starts at the heading;
 * forms move it to their first field with `useModalInitialFocus`.
 */
export function Modal(props: ModalProps) {
  const ctx = useContext(FrameContext);
  if (!ctx) {
    return (
      <ModalFrame>
        <Modal {...props} />
      </ModalFrame>
    );
  }
  return <ModalStep {...props} ctx={ctx} />;
}

function ModalStep({
  ctx,
  title,
  titleAside,
  subtitle,
  headExtra,
  closeLabel,
  onClose,
  size = "default",
  form = false,
  busy,
  children,
}: ModalProps & { ctx: ModalFrameContext }) {
  const { setVariant, closeRef, headingRef } = ctx;
  useLayoutEffect(() => setVariant(size, form), [setVariant, size, form]);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  // A new step replaced the focused element of the previous one: start again at the heading.
  // Checked for a few frames: the dialog's own focus handling may settle a frame later.
  useEffect(() => {
    let frames = 0;
    let id = 0;
    const check = () => {
      const heading = headingRef.current;
      const popup = heading?.closest(".ap-dialog");
      const active = document.activeElement;
      const lost = !active || active === document.body || active === popup;
      if (heading && popup && (lost || !popup.contains(active)))
        heading.focus({ preventScroll: true });
      if (++frames < 3) id = requestAnimationFrame(check);
    };
    id = requestAnimationFrame(check);
    return () => cancelAnimationFrame(id);
  }, [headingRef]);

  const heading = (
    <DialogPrimitive.Title
      render={<h1 />}
      ref={headingRef}
      tabIndex={-1}
      className="t-h1 ap-focus-target"
    >
      {title}
    </DialogPrimitive.Title>
  );

  return (
    <>
      <header className="ap-dialog-head">
        <div className="min-w-0">
          {titleAside ? (
            <div className="ap-row" style={{ gap: "var(--space-2)" }}>
              {heading}
              {titleAside}
            </div>
          ) : (
            heading
          )}
          {subtitle && (
            <DialogPrimitive.Description className="t-body">{subtitle}</DialogPrimitive.Description>
          )}
          {headExtra && <div style={{ marginTop: "var(--space-2)" }}>{headExtra}</div>}
        </div>
        <DialogPrimitive.Close
          render={<IconButton icon="x" variant="outline" label={closeLabel} />}
        />
      </header>
      {busy ? (
        <div className="ap-stack" aria-busy="true">
          {children}
        </div>
      ) : (
        children
      )}
    </>
  );
}

/**
 * Moves focus to a field once it is shown (e.g. the first field of a form that appears after
 * loading), unless the user already moved focus elsewhere in the dialog.
 */
export function useModalInitialFocus(fieldId: string, enabled = true) {
  const ctx = useContext(FrameContext);
  useEffect(() => {
    if (!enabled) return;
    if (ctx) ctx.startFieldRef.current = fieldId;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(fieldId);
      const popup = el?.closest(".ap-dialog");
      if (!el || !popup) return;
      const active = document.activeElement;
      const onStart =
        !active ||
        active === document.body ||
        active === popup ||
        !popup.contains(active) ||
        active.matches("h1.ap-focus-target");
      if (onStart) el.focus({ preventScroll: false });
    });
    return () => {
      cancelAnimationFrame(id);
      if (ctx && ctx.startFieldRef.current === fieldId) ctx.startFieldRef.current = null;
    };
  }, [fieldId, enabled, ctx]);
}
