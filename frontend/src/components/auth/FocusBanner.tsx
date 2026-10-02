import { useEffect, useRef, type ComponentProps } from "react";
import { Banner } from "@/components/ui/shared";

/**
 * Banner that moves keyboard/screen reader focus to itself when it appears,
 * so form errors are noticed without hunting for them. Mount it only while the message is shown.
 */
export function FocusBanner(props: ComponentProps<typeof Banner>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="ap-focus-target">
      <Banner {...props} />
    </div>
  );
}
