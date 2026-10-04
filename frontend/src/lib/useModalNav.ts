import { useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { modalBackground, modalState, type ModalNavState } from "./modalRoutes";

/**
 * Navigation inside a routed modal: steps replace the history entry (one entry per opened dialog,
 * so the browser's back button closes it), closing goes back to the background page.
 */
export function useModalNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = modalState(location);
  const background = modalBackground(location) ?? "/";
  const stored = state.background;
  const direct = !!state.direct || !stored;

  /** Next / previous step of the same dialog (keeps the background). */
  const step = useCallback(
    (to: string) =>
      navigate(to, {
        replace: true,
        state: { background: stored, direct: state.direct } satisfies ModalNavState,
      }),
    [navigate, stored, state.direct],
  );

  /** Props of a `<Link>` / `LinkButton` to another step (same as `step`, but a real link). */
  const stepLink = useCallback(
    (to: string) => ({
      to,
      replace: true,
      state: { background: stored, direct: state.direct } satisfies ModalNavState,
    }),
    [stored, state.direct],
  );

  /** Back to the page below: history back if the dialog was opened from it, else replace. */
  const close = useCallback(() => {
    if (direct) navigate(background, { replace: true });
    else navigate(-1);
  }, [direct, background, navigate]);

  /**
   * A deep link learned a better background (e.g. the event's month): remember it in the entry.
   * `background` is stored as given, public pages pass it without the secret.
   */
  const setBackground = useCallback(
    (path: string) =>
      navigate(location.pathname + location.search, {
        replace: true,
        state: { background: path, direct: true } satisfies ModalNavState,
      }),
    [navigate, location.pathname, location.search],
  );

  return useMemo(
    () => ({
      background,
      direct,
      hasStoredBackground: !!stored,
      step,
      stepLink,
      close,
      setBackground,
    }),
    [background, direct, stored, step, stepLink, close, setBackground],
  );
}
