import { useEffect } from "react";
import { useAppName } from "@/lib/appName";

/** Sets `document.title` to "<title> – <instance name>" while the page is mounted (no title: untouched). */
export function usePageTitle(title: string | null | undefined) {
  const appName = useAppName();
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} – ${appName}`;
    return () => {
      document.title = previous;
    };
  }, [title, appName]);
}
