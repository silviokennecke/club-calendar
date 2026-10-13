import { useEffect } from "react";

/** Adds `<meta name content>` to the head while the component is mounted (none when `content` is null). */
export function useMetaTag(name: string, content: string | null) {
  useEffect(() => {
    if (content === null) return;
    const meta = document.createElement("meta");
    meta.name = name;
    meta.content = content;
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [name, content]);
}
