import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type Glyph } from "./Icon";

interface Props {
  title: ReactNode;
  /** Why it is empty / what to do next. */
  text?: ReactNode;
  icon?: Glyph;
  /** Next action(s), e.g. a primary LinkButton. */
  actions?: ReactNode;
  /** Heading level for the title (default h2). */
  headingLevel?: "h1" | "h2" | "h3";
  className?: string;
}

/** Empty list: explains why it is empty and offers the next step. */
export function EmptyState({
  title,
  text,
  icon = "calendar",
  actions,
  headingLevel = "h2",
  className,
}: Props) {
  const Heading = headingLevel;
  return (
    <div className={cn("ap-empty", className)}>
      <span className="ap-empty-icon">
        <Icon glyph={icon} size={28} />
      </span>
      <Heading className="t-h3">{title}</Heading>
      {text && <p className="t-body">{text}</p>}
      {actions && (
        <div className="ap-actions" style={{ justifyContent: "center" }}>
          {actions}
        </div>
      )}
    </div>
  );
}
