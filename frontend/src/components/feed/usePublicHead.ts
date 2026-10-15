import { useEffect } from "react";
import { useMetaTag } from "@/lib/useMetaTag";

interface PublicHead {
  /** Document title; never put the secret in it. */
  title: string;
  /** Ask search engines to skip the page (private feeds, error pages). */
  noindex: boolean;
}

/**
 * Head settings of the public pages. The address of a private feed contains its secret, so the
 * pages never send a Referer to other hosts (`referrer: no-referrer`); private feeds and error
 * pages are marked noindex. (The web server additionally sends `Referrer-Policy: no-referrer` for
 * `/feed/*`; `X-Robots-Tag` is only sent by the backend for the feed API.)
 */
export function usePublicHead({ title, noindex }: PublicHead) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useMetaTag("referrer", "no-referrer");
  useMetaTag("robots", noindex ? "noindex, nofollow" : null);
}
