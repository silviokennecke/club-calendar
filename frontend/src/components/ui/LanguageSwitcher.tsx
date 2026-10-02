import { useTranslation } from "react-i18next";

interface Props {
  className?: string;
  onChange?: (lang: string) => void;
}

export function LanguageSwitcher({ className, onChange }: Props) {
  const { i18n, t } = useTranslation();
  const current = i18n.resolvedLanguage ?? "en";

  return (
    <select
      value={current}
      onChange={(e) => {
        i18n.changeLanguage(e.target.value);
        onChange?.(e.target.value);
      }}
      className={className ?? "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"}
    >
      <option value="en">{t("language.en")}</option>
      <option value="de">{t("language.de")}</option>
    </select>
  );
}
