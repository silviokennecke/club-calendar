import { useEffect } from "react";
import { useMetaTag } from "@/lib/useMetaTag";

interface PublicHead {
  /** Document title; never put the secret in it. */
  title: string;
  /**
   * `feed.indexable` of the API: only a PUBLIC feed with the search engine option. Anything else
   * (club internal, private, loading and error states, a missing value) is noindex.
   */
  indexable?: boolean;
}

/**
 * Head settings of the public pages. The address of a private feed contains its secret, so the
 * pages never send a Referer to other hosts (`referrer: no-referrer`); every page is marked noindex
 * unless the feed may be indexed (`indexable === true`). (The web server additionally sends
 * `Referrer-Policy: no-referrer` for `/feed/*`; `X-Robots-Tag` is only sent by the backend for the
 * feed API, by the same rule.)
 */
export function usePublicHead({ title, indexable }: PublicHead) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useMetaTag("referrer", "no-referrer");
  useMetaTag("robots", indexable === true ? null : "noindex, nofollow");
}
