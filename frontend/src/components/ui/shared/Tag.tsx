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

interface TagBadgeProps {
  label: string;
  icon?: string | null;
  tone?: TagTone;
  className?: string;
}

/** Convenience wrapper: label + optional emoji. */
export function TagBadge({ label, icon, tone = "neutral", className }: TagBadgeProps) {
  return (
    <Tag tone={tone} emoji={icon} className={className}>
      {label}
    </Tag>
  );
}

interface TagBadgeRowItem {
  id: string | number;
  name: string;
  icon?: string | null;
}

interface TagBadgeRowProps {
  items: TagBadgeRowItem[];
  tone?: TagTone;
  className?: string;
}

export function TagBadgeRow({ items, tone = "neutral", className }: TagBadgeRowProps) {
  if (items.length === 0) return null;
  return (
    <div className={cn("cc-tags", className)}>
      {items.map((item) => (
        <TagBadge key={item.id} label={item.name} icon={item.icon} tone={tone} />
      ))}
    </div>
  );
}
