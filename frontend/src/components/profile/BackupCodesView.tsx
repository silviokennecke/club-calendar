import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/shared";

/** Backup codes with copy and .txt download; the codes are shown only once. */
export function BackupCodesView({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([`${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "club-calendar-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="ap-stack ap-stack--sm">
      <ul
        aria-label={t("profile.mfa.codes.listLabel")}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="ap-actions">
        <Button variant="secondary" icon="copy" onClick={() => void copy()}>
          {copied ? t("profile.mfa.codes.copied") : t("profile.mfa.codes.copy")}
        </Button>
        <Button variant="secondary" icon="download" onClick={download}>
          {t("profile.mfa.codes.download")}
        </Button>
      </div>
    </div>
  );
}
