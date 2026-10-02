import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props<T extends { id: string | number }> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  emptyMessage: string;
  className?: string;
}

export function ListCard<T extends { id: string | number }>({
  items,
  renderItem,
  emptyMessage,
  className,
}: Props<T>) {
  return (
    <div className={cn("ap-panel ap-panel--flush", className)}>
      {items.length === 0 ? (
        <p className="t-sm t-muted p-4">{emptyMessage}</p>
      ) : (
        <ul className="ap-list">
          {items.map((item) => (
            <li key={item.id} className="border-border border-t first:border-t-0">
              {renderItem(item)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
