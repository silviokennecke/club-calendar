import { useEffect } from "react";

interface PublicHead {
  /** Document title; never put the secret in it. */
  title: string;
  /** Ask search engines to skip the page (private feeds, error pages). */
  noindex: boolean;
}

/** Sets or removes a `<meta name>` for the lifetime of the page; returns the cleanup. */
function setMeta(name: string, content: string): () => void {
  const meta = document.createElement("meta");
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
  return () => meta.remove();
}

/**
 * Head settings of the public pages. The address of a private feed contains its secret, so the
 * pages never send a Referer to other hosts (`referrer: no-referrer`); private feeds and error
 * pages are marked noindex. (A server-side `X-Robots-Tag` / `Referrer-Policy` header at the web
 * server is the stricter variant; the SPA can only set the meta tags.)
 */
export function usePublicHead({ title, noindex }: PublicHead) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  useEffect(() => setMeta("referrer", "no-referrer"), []);

  useEffect(() => (noindex ? setMeta("robots", "noindex, nofollow") : undefined), [noindex]);
}
