import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Field, TextInput } from "./Field";
import { Icon } from "./Icon";

interface PasswordFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Adds "(Pflicht)" to the label and aria-required. */
  requiredLabel?: boolean;
  id?: string;
}

/** Password input with a show/hide toggle (aria-pressed, constant accessible name). */
export function PasswordField({
  label,
  hint,
  error,
  requiredLabel,
  id,
  className,
  ...inputProps
}: PasswordFieldProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);

  return (
    <Field label={label} hint={hint} error={error} required={requiredLabel} id={id}>
      {(control) => (
        <div className="ap-pw">
          <TextInput
            {...inputProps}
            {...control}
            className={className}
            type={shown ? "text" : "password"}
          />
          <button
            type="button"
            className="ap-iconbtn"
            aria-label={t("ui.passwordField.toggle")}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
          >
            <Icon glyph={shown ? "eye-off" : "eye"} size={20} />
          </button>
        </div>
      )}
    </Field>
  );
}
