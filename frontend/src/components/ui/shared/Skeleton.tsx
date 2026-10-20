import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

/**
 * Grey placeholder showing the later shape while loading.
 * Put `aria-busy="true"` on the surrounding region.
 */
export function Skeleton({ className, style }: SkeletonProps) {
  return <span aria-hidden="true" className={cn("ap-skel ap-delayed", className)} style={style} />;
}
