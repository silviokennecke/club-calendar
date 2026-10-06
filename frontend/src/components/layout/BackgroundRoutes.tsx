import { Suspense, type ReactNode } from "react";
import { Routes, useLocation } from "react-router-dom";
import { modalBackground } from "@/lib/modalRoutes";
import { useModalFocusReturn } from "@/lib/modalFocus";
import { useHistoryFocus } from "@/lib/historyFocus";
import { FullPageLoader } from "@/components/ui/shared";

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
 */
export function BackgroundRoutes({ pages, modals }: BackgroundRoutesProps) {
  const location = useLocation();
  const background = modalBackground(location);
  useModalFocusReturn(!!background);
  useHistoryFocus();

  return (
    <Suspense fallback={<FullPageLoader />}>
      <div className="contents" inert={background ? true : undefined}>
        <Routes location={background ?? location}>{pages}</Routes>
      </div>
      {background && <Routes>{modals}</Routes>}
    </Suspense>
  );
}
