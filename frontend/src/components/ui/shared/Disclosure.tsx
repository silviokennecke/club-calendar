import { forwardRef, ReactNode } from "react";
import { Icon } from "./Icon";

export interface DisclosureProps {
  /** The disclosure title, rendered inside the summary. Can be a string or JSX. */
  title: ReactNode;
  /** The content inside the disclosure, rendered after the summary. */
  children: ReactNode;
  /** Optional CSS class name for the details element. */
  className?: string;
  /** Callback when the disclosure is toggled. */
  onToggle?: (open: boolean) => void;
}

/**
 * A collapsible disclosure element with a chevron icon that rotates when open.
 * Renders a native `<details>` with styled summary and a rotating chevron.
 */
export const Disclosure = forwardRef<HTMLDetailsElement, DisclosureProps>(
  ({ title, children, className = "", onToggle }, ref) => {
    return (
      <details
        ref={ref}
        className={`ap-details ${className}`}
        onToggle={(e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>
          <span>{title}</span>
          <Icon glyph="chevron-right" aria-hidden className="ap-disclosure-chevron" />
        </summary>
        {children}
      </details>
    );
  },
);

Disclosure.displayName = "Disclosure";
