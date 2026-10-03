import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isIcsFile, parseIcs, type IcsParseResult } from "@/lib/import";
import { Banner, Button, Icon, LinkButton, Skeleton } from "@/components/ui/shared";

export interface ParsedFile extends IcsParseResult {
  fileName: string;
}

type Phase = "idle" | "reading" | "ready" | "wrongType" | "empty" | "unreadable";

interface ImportUploadProps {
  /** Where "Abbrechen" leads (the calendar). */
  cancelTo: string;
  /** Zone UTC times of the file are converted to. */
  timeZone: string | null;
  /** The file chosen before (when coming back from the review). */
  initial: ParsedFile | null;
  onParsed: (file: ParsedFile) => void;
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/**
 * Step 1 of the import (design: Import): choose or drop an .ics file. The file input is a real,
 * keyboard-reachable control with a label; drag and drop is only a shortcut. The file is read and
 * parsed in the browser (there is no dry run in the backend).
 */
export function ImportUpload({ cancelTo, timeZone, initial, onParsed }: ImportUploadProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>(initial ? "ready" : "idle");
  const [file, setFile] = useState<ParsedFile | null>(initial);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function take(chosen: File | undefined) {
    if (!chosen) return;
    setFile(null);
    if (!isIcsFile(chosen)) {
      setPhase("wrongType");
      return;
    }
    setPhase("reading");
    try {
      const result = parseIcs(await readText(chosen), { timeZone });
      if (result.events.length === 0 && result.skipped.length === 0) {
        setPhase("empty");
        return;
      }
      setFile({ ...result, fileName: chosen.name });
      setPhase(result.events.length === 0 ? "empty" : "ready");
    } catch {
      setPhase("unreadable");
    }
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    void take(e.target.files?.[0]);
    // Allows choosing the same file again after fixing it.
    e.target.value = "";
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void take(e.dataTransfer.files[0]);
  }

  const reading = phase === "reading";
  const blocked = phase !== "ready" || !file;

  return (
    <div className="ap-stack ap-stack--lg">
      {phase === "wrongType" && (
        <Banner tone="danger" title={t("import.upload.wrong.title")}>
          {t("import.upload.wrong.text")}
        </Banner>
      )}
      {phase === "empty" && (
        <Banner tone="danger" title={t("import.upload.empty.title")}>
          {t("import.upload.empty.text")}
        </Banner>
      )}
      {phase === "unreadable" && (
        <Banner tone="danger" title={t("import.upload.unreadable.title")}>
          {t("import.upload.unreadable.text")}
        </Banner>
      )}

      <section aria-labelledby="import-file-h">
        <h2 className="t-h2" id="import-file-h" style={{ marginBottom: "var(--space-3)" }}>
          {t("import.upload.heading")}
        </h2>
        <div
          className={cn("ap-fileinput", dragOver && "ap-fileinput--active")}
          aria-busy={reading || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {reading ? (
            <div
              role="status"
              className="ap-stack ap-stack--sm"
              style={{ width: "100%", maxWidth: 420 }}
            >
              <Skeleton style={{ display: "block", height: 20, width: "60%", margin: "0 auto" }} />
              <Skeleton style={{ display: "block", height: 16, width: "90%", margin: "0 auto" }} />
              <Skeleton style={{ display: "block", height: 16, width: "75%", margin: "0 auto" }} />
              <p className="t-body">{t("import.upload.reading")}</p>
            </div>
          ) : (
            <>
              <Icon glyph="upload" size={40} />
              <p className="t-h3">{t("import.upload.dropTitle")}</p>
              <p className="t-sm t-muted">{t("import.upload.dropHint")}</p>
              <label htmlFor="ics-file" className="cc cc-btn cc-btn--secondary">
                {file ? t("import.upload.chooseOther") : t("import.upload.choose")}
              </label>
              <input
                ref={inputRef}
                id="ics-file"
                type="file"
                accept=".ics,text/calendar"
                className="ap-sr"
                aria-describedby="ics-file-hint"
                onChange={onChange}
              />
              <p className="t-sm t-muted" id="ics-file-hint">
                {t("import.upload.keyboardHint")}
              </p>
              <p className="ap-row t-label" role="status" style={{ justifyContent: "center" }}>
                {file && phase === "ready" && (
                  <>
                    <Icon glyph="check-circle" size={20} />
                    {t("import.upload.chosen", { name: file.fileName, count: file.events.length })}
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </section>

      <div className="ap-actions ap-actions--split">
        <LinkButton variant="secondary" to={cancelTo}>
          {t("common.cancel")}
        </LinkButton>
        <Button disabled={blocked} onClick={() => file && onParsed(file)}>
          {t("import.upload.next")}
          <Icon glyph="arrow-right" size={18} />
        </Button>
      </div>
    </div>
  );
}
