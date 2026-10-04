import type { ReactNode } from "react";
import { Routes, useLocation } from "react-router-dom";
import { modalBackground } from "@/lib/modalRoutes";
import { useModalFocusReturn } from "@/lib/modalFocus";

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
 */
export function BackgroundRoutes({ pages, modals }: BackgroundRoutesProps) {
  const location = useLocation();
  const background = modalBackground(location);
  useModalFocusReturn(!!background);

  return (
    <>
      <div className="contents" inert={background ? true : undefined}>
        <Routes location={background ?? location}>{pages}</Routes>
      </div>
      {background && <Routes>{modals}</Routes>}
    </>
  );
}
