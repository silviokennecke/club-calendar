import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Routes, useLocation, type Location } from "react-router-dom";
import { modalBackground } from "@/lib/modalRoutes";
import { useModalFocusReturn } from "@/lib/modalFocus";
import { useHistoryFocus } from "@/lib/historyFocus";
import { FullPageLoader } from "@/components/ui/shared";
import { ModalClosingContext } from "@/components/ui/shared/Modal";
import { motionMs, prefersReducedMotion } from "@/lib/motion";

interface BackgroundRoutesProps {
  /** `<Route>`s of the pages. */
  pages: ReactNode;
  /** `<Route>`s of the routed modals (`lib/modalRoutes.ts` decides which paths are modals). */
  modals: ReactNode;
}

/**
 * Background-location pattern: pages render at the current location – or, while a routed modal is
 * open (event dialogs, public event), at the modal's background location. The page stays visible
 * and mounted below the dialog but is inert (no focus, no clicks; the dialog also hides it from
 * assistive technology); the modal routes render on top. Focus returns to the opener afterwards.
 *
 * Pages and modals are lazy chunks (`pages/lazy.ts`). This boundary covers the first load; later page
 * navigations run in the router's transition, so the current page stays until the next chunk is
 * there. The app shell has its own boundary (a first load inside it keeps sidebar and tab bar), and
 * `ModalFrame` one inside the dialog: the dialog's content renders in a portal outside the transition,
 * so a dialog chunk that is still loading shows a loading state in the opened dialog.
 *
 * Closing a modal changes the route at once; the modal routes stay rendered at the old location for
 * the exit duration with `ModalClosingContext` set, so the dialog plays its exit animation.
 */
export function BackgroundRoutes({ pages, modals }: BackgroundRoutesProps) {
  const location = useLocation();
  const background = modalBackground(location);
  useModalFocusReturn(!!background);
  useHistoryFocus();

  const [shown, setShown] = useState<Location | null>(null);
  const [closing, setClosing] = useState<Location | null>(null);
  if (background && shown !== location) setShown(location);
  if (background && closing) setClosing(null);
  if (!background && shown) {
    setShown(null);
    if (!prefersReducedMotion()) setClosing(shown);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(null), motionMs("--dur-exit-slow"));
    return () => clearTimeout(timer);
  }, [closing]);
  const modalLocation = background ? location : closing;

  return (
    <Suspense fallback={<FullPageLoader />}>
      <div className="contents" inert={background ? true : undefined}>
        <Routes location={background ?? location}>{pages}</Routes>
      </div>
      {modalLocation && (
        <ModalClosingContext.Provider value={!background}>
          <Routes location={modalLocation}>{modals}</Routes>
        </ModalClosingContext.Provider>
      )}
    </Suspense>
  );
}
