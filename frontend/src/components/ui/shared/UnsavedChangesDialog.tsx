import { useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { UNSAFE_DataRouterContext, useBlocker, type BlockerFunction } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";

interface BlockerProps {
  /** Read at navigation time (a ref behind it), true while there are unsaved changes. */
  shouldBlock: () => boolean;
  onBlocked: (proceed: () => void, reset: () => void) => void;
  /** Also block back / forward entries with the same path and query (steps kept in the history state). */
  samePath?: boolean;
}

interface UnsavedChangesDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Overrides the default sentence (e.g. names the edited item). */
  description?: ReactNode;
  /** From `useUnsavedChanges().dialog`: also asks before the browser's back / forward buttons. */
  blocker?: BlockerProps;
}

/** "Änderungen verwerfen?" – use with `useUnsavedChanges()` from `@/lib/useUnsavedChanges`. */
export function UnsavedChangesDialog({
  open,
  onCancel,
  onConfirm,
  description,
  blocker,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();
  // useBlocker needs a data router (the app); tests with <MemoryRouter> render without it.
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  return (
    <>
      {blocker && dataRouter && <HistoryBlocker {...blocker} />}
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => !next && onCancel()}
        icon="alert"
        title={t("ui.unsaved.title")}
        description={description ?? t("ui.unsaved.text")}
        consequence={t("ui.unsaved.consequence")}
        confirmLabel={t("ui.unsaved.confirm")}
        cancelLabel={t("ui.unsaved.cancel")}
        onConfirm={onConfirm}
      />
    </>
  );
}

/**
 * Holds back / forward (POP) navigations while there are unsaved changes; links and the page's own
 * navigation are handled by `useUnsavedChanges` itself.
 */
function HistoryBlocker({ shouldBlock, onBlocked, samePath }: BlockerProps) {
  const when = useCallback<BlockerFunction>(
    ({ historyAction, currentLocation, nextLocation }) =>
      historyAction === "POP" &&
      shouldBlock() &&
      (!!samePath ||
        currentLocation.pathname + currentLocation.search !==
          nextLocation.pathname + nextLocation.search),
    [shouldBlock, samePath],
  );
  const blocker = useBlocker(when);
  const ref = useRef(blocker);
  ref.current = blocker;
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    onBlocked(
      () => ref.current.proceed?.(),
      () => ref.current.reset?.(),
    );
  }, [blocker.state, onBlocked]);
  return null;
}
