import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** Props a Field hands to its form control. */
export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

interface FieldProps {
  label: ReactNode;
  /** Help text below the control (what to enter). */
  hint?: ReactNode;
  /** Error text; replaces nothing, is shown below the hint and marks the control invalid. */
  error?: ReactNode;
  /** Adds "(Pflicht)"/"(required)" to the label and aria-required to the control. */
  required?: boolean;
  /** Adds "(optional)" to the label. */
  optional?: boolean;
  /** Control id; generated when omitted. */
  id?: string;
  /**
   * Group mode for composite controls (button rows, maps, chip lists): renders a
   * role="group" labelled by the label text instead of a <label for>.
   */
  group?: boolean;
  className?: string;
  /**
   * A single control element (receives id/aria props via cloneElement), a render
   * function that spreads the given props onto the actual control, or (group mode) any content.
   */
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}

/** Label + control + hint + error, wired with htmlFor / aria-describedby / aria-invalid. */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  id,
  group,
  className,
  children,
}: FieldProps) {
  const { t } = useTranslation();
  const autoId = useId();
  const controlId = id ?? `field-${autoId.replace(/:/g, "")}`;
  const labelId = `${controlId}-label`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control: FieldControlProps = {
    id: controlId,
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    ...(error ? { "aria-invalid": true as const } : {}),
    ...(required ? { "aria-required": true as const } : {}),
  };

  const labelContent = (
    <>
      {label}
      {required && <span className="font-normal"> {t("ui.field.required")}</span>}
      {optional && <span className="t-muted font-normal"> {t("ui.field.optional")}</span>}
    </>
  );

  let rendered: ReactNode;
  if (typeof children === "function") {
    rendered = children(control);
  } else if (!group && isValidElement<Record<string, unknown>>(children)) {
    const existing = children.props["aria-describedby"] as string | undefined;
    rendered = cloneElement(children, {
      ...control,
      "aria-describedby": [existing, describedBy].filter(Boolean).join(" ") || undefined,
    });
  } else {
    rendered = children;
  }

  const helpers = (
    <>
      {hint && (
        <span id={hintId} className="cc-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="cc-hint cc-hint--error">
          {error}
        </span>
      )}
    </>
  );

  if (group) {
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className={cn("cc-field", className)}
      >
        <span id={labelId} className="cc-label">
          {labelContent}
        </span>
        {rendered}
        {helpers}
      </div>
    );
  }

  return (
    <div className={cn("cc-field", className)}>
      <label id={labelId} className="cc-label" htmlFor={controlId}>
        {labelContent}
      </label>
      {rendered}
      {helpers}
    </div>
  );
}

/** Text input in design-system style (use inside Field). */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, type = "text", ...rest }, ref) {
    const hygiene = type === "email" || type === "url";
    const inputModeMap: Record<string, string> = { email: "email", url: "url", tel: "tel" };
    const defaultMode = inputModeMap[type] as "email" | "url" | "tel" | undefined;
    return (
      <input
        ref={ref}
        type={type}
        className={cn("cc-input", className)}
        {...(hygiene ? { spellCheck: false, autoCapitalize: "none" } : {})}
        {...(defaultMode ? { inputMode: defaultMode } : {})}
        {...rest}
      />
    );
  },
);

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("cc-input", className)} {...rest} />;
});

export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, ...rest }, ref) {
    return <select ref={ref} className={cn("cc-input", className)} {...rest} />;
  },
);
