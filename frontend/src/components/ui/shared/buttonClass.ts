import { cn } from "@/lib/utils";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "danger-solid" | "ghost-danger";

export function buttonClass(variant: ButtonVariant = "primary", block = false, className?: string) {
  return cn("cc-btn", `cc-btn--${variant}`, block && "cc-btn--block", className);
}
