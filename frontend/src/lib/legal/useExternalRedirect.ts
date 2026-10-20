import { useEffect } from "react";
import type { LegalDocument } from "./index";

/**
 * Leaves the app for an externally linked document (`url` set): `location.replace`, so "back" does not
 * return to the empty document. True while the redirect is under way (show a loader, not the document).
 */
export function useExternalRedirect(document: Pick<LegalDocument, "url"> | undefined): boolean {
  const url = document?.url ?? null;
  useEffect(() => {
    if (url) window.location.replace(url);
  }, [url]);
  return !!url;
}
