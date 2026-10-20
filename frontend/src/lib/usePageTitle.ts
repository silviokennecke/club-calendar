import { useEffect } from "react";

export const APP_NAME = "Club Calendar";

/** Sets `document.title` to "<title> – Club Calendar" while the page is mounted (no title: untouched). */
export function usePageTitle(title: string | null | undefined) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} – ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
