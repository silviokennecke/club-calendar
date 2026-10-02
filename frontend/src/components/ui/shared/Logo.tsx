import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface LogoProps {
  /** "full" = mark + word mark, "mark" = only the symbol (with accessible name). */
  variant?: "full" | "mark";
  size?: number;
  className?: string;
}

export function Logo({ variant = "full", size = 40, className }: LogoProps) {
  const { t } = useTranslation();
  const uid = useId().replace(/:/g, "");
  const clipId = `cc-logo-${uid}`;
  const name = t("brand.name");

  const mark = (
    <svg
      viewBox="9 7 46 48"
      width={size}
      height={Math.round((size * 48) / 46)}
      aria-hidden="true"
      focusable="false"
    >
      <clipPath id={clipId}>
        <rect x={11} y={15} width={42} height={38} rx={7} />
      </clipPath>
      <rect x={11} y={15} width={42} height={38} rx={7} fill="var(--surface-raised)" />
      <path d="M11 22a7 7 0 0 1 7-7h28a7 7 0 0 1 7 7v6H11z" fill="var(--accent)" />
      <rect x={20} y={9} width={5} height={12} rx={2.5} fill="var(--brand)" />
      <rect x={39} y={9} width={5} height={12} rx={2.5} fill="var(--brand)" />
      <g clipPath={`url(#${clipId})`}>
        <g fill="var(--border-strong)">
          <circle cx={20.5} cy={38} r={3.2} />
          <path d="M13 56v-6a7.5 7.5 0 0 1 15 0v6z" />
          <circle cx={43.5} cy={38} r={3.2} />
          <path d="M36 56v-6a7.5 7.5 0 0 1 15 0v6z" />
        </g>
        <g fill="var(--brand)" stroke="var(--surface-raised)" strokeWidth={1.5}>
          <circle cx={32} cy={35.5} r={4.2} />
          <path d="M23 56v-6.5a9 9 0 0 1 18 0V56z" />
        </g>
      </g>
      <rect
        x={11}
        y={15}
        width={42}
        height={38}
        rx={7}
        fill="none"
        stroke="var(--brand)"
        strokeWidth={2.5}
      />
    </svg>
  );

  if (variant === "mark") {
    return (
      <span className={cn("cc-logo", className)} role="img" aria-label={name}>
        {mark}
      </span>
    );
  }
  return (
    <span className={cn("cc-logo", className)}>
      {mark}
      {name}
    </span>
  );
}
