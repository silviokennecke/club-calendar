import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useDelayedVisible } from "@/lib/useDelayedVisible";
import { Icon, type Glyph } from "./Icon";
import { buttonClass, type ButtonVariant } from "./buttonClass";

interface CommonProps {
  variant?: ButtonVariant;
  /** Leading icon (design glyph name). */
  icon?: Glyph;
  /** Full width. */
  block?: boolean;
}

export interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows the loading label and disables the button. */
  loading?: boolean;
  loadingLabel?: ReactNode;
}

/** Design-system button. One primary per view; destructive actions use a danger variant. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    icon,
    block,
    loading,
    loadingLabel,
    className,
    children,
    type = "button",
    disabled,
    ...rest
  },
  ref,
) {
  const showSpinner = useDelayedVisible(!!loading);
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, block, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {showSpinner ? (
        <Icon glyph="loader" size={18} className="animate-spin motion-reduce:animate-none" />
      ) : (
        icon && <Icon glyph={icon} size={18} />
      )}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
});

export interface LinkButtonProps extends CommonProps, Omit<LinkProps, "className"> {
  className?: string;
}

/** A router link styled as a button (navigation, not an action). */
export function LinkButton({
  variant = "primary",
  icon,
  block,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, block, className)} {...rest}>
      {icon && <Icon glyph={icon} size={18} />}
      {children}
    </Link>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name – required because the button only shows an icon. */
  label: string;
  icon: Glyph;
  variant?: "default" | "outline" | "danger";
  size?: number;
}

/** Square 44px icon-only button with an aria-label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "default", size = 20, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "ap-iconbtn",
        variant === "outline" && "ap-iconbtn--outline",
        variant === "danger" && "ap-iconbtn--danger",
        className,
      )}
      {...rest}
    >
      <Icon glyph={icon} size={size} />
    </button>
  );
});
