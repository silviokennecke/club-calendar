import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";

interface StepperProps {
  steps: string[];
  /** 1-based index of the current step. */
  current: number;
  className?: string;
}

/** Shows progress through a setup flow (not navigable). */
export function Stepper({ steps, current, className }: StepperProps) {
  const { t } = useTranslation();
  return (
    <ol className={cn("ap-steps", className)} aria-label={t("ui.stepper.label")}>
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        return (
          <Fragment key={label}>
            <li
              className={cn("ap-step", done && "ap-step--done")}
              aria-current={n === current ? "step" : undefined}
            >
              <span className="ap-step-n">{done ? <Icon glyph="check" size={16} /> : n}</span>
              {label}
              {done && <span className="ap-sr"> {t("ui.stepper.done")}</span>}
              {n < steps.length && <span className="ap-step-line" aria-hidden="true" />}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
