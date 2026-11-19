import type { ReactElement, ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";

interface TooltipProps {
  /** Text of the tooltip. It describes the trigger; the trigger must carry its own accessible name. */
  label: ReactNode;
  /** The single element that triggers the tooltip (must accept a ref and DOM props). */
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  disabled?: boolean;
}

/** Hover and keyboard-focus tooltip (Base UI), rendered in a portal so scroll containers never clip it. */
export function Tooltip({ label, children, side = "right", disabled }: TooltipProps) {
  return (
    <BaseTooltip.Root disabled={disabled}>
      <BaseTooltip.Trigger delay={300} render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={8} className="ap-tooltip-pos">
          <BaseTooltip.Popup className="ap-tooltip" role="tooltip">
            {label}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
