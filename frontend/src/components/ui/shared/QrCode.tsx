import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Skeleton } from "./Skeleton";

interface QrCodeProps {
  value: string;
  alt: string;
  size?: number;
  className?: string;
}

type State = { status: "loading" } | { status: "ready"; src: string } | { status: "error" };

/** QR code as data-URL image; always black on white, also in dark theme. */
export function QrCode({ value, alt, size = 192, className }: QrCodeProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    import("qr")
      .then(({ default: encodeQR }) => {
        const svg = encodeQR(value, "svg", { ecc: "medium", border: 4 }).replace(
          "<path ",
          '<path fill="#000000" ',
        );
        if (!cancelled) {
          setState({ status: "ready", src: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (state.status === "error") {
    return (
      <p role="alert" className={cn("cc-hint cc-hint--error", className)}>
        {t("ui.qrCode.failed")}
      </p>
    );
  }

  return (
    <div
      aria-busy={state.status === "loading"}
      className={cn("inline-block rounded-md bg-white p-2", className)}
      style={{ width: size, height: size, boxSizing: "content-box" }}
    >
      {state.status === "ready" ? (
        <img src={state.src} alt={alt} width={size} height={size} />
      ) : (
        <Skeleton style={{ display: "block", width: size, height: size }} />
      )}
    </div>
  );
}
