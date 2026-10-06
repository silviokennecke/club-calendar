import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type TagTone = "neutral" | "youth" | "adult" | "senior" | "brand" | "accent" | "danger";

interface TagProps {
  tone?: TagTone;
  /** Optional club-chosen emoji (content, not a UI icon); hidden from screen readers. */
  emoji?: string | null;
  className?: string;
  children: ReactNode;
}

/** Small label for audiences, properties, features. Always carries a word. */
export function Tag({ tone = "neutral", emoji, className, children }: TagProps) {
  return (
    <span className={cn("cc-tag", tone !== "neutral" && `cc-tag--${tone}`, className)}>
      {emoji && <span aria-hidden="true">{emoji}</span>}
      {children}
    </span>
  );
}
