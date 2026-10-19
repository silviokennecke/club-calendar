import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTranslation } from "react-i18next";
import { Icon } from "./Icon";

/**
 * App-wide toast region (sonner) styled as the design's Toast: dark pill at the bottom,
 * success with a check-circle, errors in danger color with an alert icon.
 * Use `toast.success(text)` / `toast.error(text)` (re-exported from the shared index).
 */
export function Toaster(props: ToasterProps) {
  const { t } = useTranslation();
  return (
    <Sonner
      position="bottom-center"
      containerAriaLabel={t("ui.toast.region")}
      icons={{
        success: <Icon glyph="check-circle" size={20} />,
        error: <Icon glyph="alert" size={20} />,
        warning: <Icon glyph="alert" size={20} />,
        info: <Icon glyph="info" size={20} />,
        loading: (
          <Icon glyph="loader" size={20} className="animate-spin motion-reduce:animate-none" />
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "ap-toast",
          error: "ap-toast--danger",
          title: "ap-grow",
        },
      }}
      {...props}
    />
  );
}
