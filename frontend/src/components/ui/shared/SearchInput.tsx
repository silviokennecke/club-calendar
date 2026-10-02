import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Icon } from "./Icon";
import { IconButton } from "./Button";

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  /** Accessible label (visually hidden); defaults to the placeholder. */
  label?: string;
  className?: string;
}

export function SearchInput({ value, onChange, placeholder, label, className }: Props) {
  const { t } = useTranslation();
  const id = `search-${useId().replace(/:/g, "")}`;
  const ph = placeholder ?? t("common.search");
  return (
    <div className={cn("ap-search", className)}>
      <span className="ap-search-icon">
        <Icon glyph="search" size={20} />
      </span>
      <label className="ap-sr" htmlFor={id}>
        {label ?? ph}
      </label>
      <input
        id={id}
        type="search"
        className="cc-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
      />
      {value && (
        <IconButton
          className="ap-search-clear"
          icon="x"
          size={18}
          label={t("ui.search.clear")}
          onClick={() => onChange("")}
        />
      )}
    </div>
  );
}
