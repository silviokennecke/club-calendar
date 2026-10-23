import { useEffect, useRef, useState, type ReactNode } from "react";

const EXIT_MS = 260;

/**
 * Animated show/hide for a block of the sign-in flow: height via grid-template-rows 0fr -> 1fr, plus a
 * short fade/slide (CSS, off for reduced motion). Closed content is inert and unmounted after the exit.
 */
export function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      // commit the closed state once so the transition has a start value
      void ref.current?.getBoundingClientRect();
      setShown(true);
      return;
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      className="ap-collapse"
      data-open={open && shown ? "true" : "false"}
      inert={!open}
      aria-hidden={!open || undefined}
    >
      <div className="ap-collapse-inner">{children}</div>
    </div>
  );
}
