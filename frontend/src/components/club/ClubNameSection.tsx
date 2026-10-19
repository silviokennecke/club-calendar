import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Button,
  ErrorSummary,
  Field,
  TextInput,
  UnsavedChangesDialog,
  toast,
} from "@/components/ui/shared";
import { apiPatch } from "@/lib/api";
import { isBlank } from "@/lib/club";
import { permissionsFor } from "@/lib/club/permissions";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import type { Club } from "@/lib/types";

/** "Vereinsname" panel (design: Club): one field, Enter or the button saves. */
export function ClubNameSection({ club }: { club: Club }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [signal, setSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = draft ?? club.name;
  const unsaved = useUnsavedChanges(draft !== null && draft !== club.name);
  // Renaming the club is admin-only.
  const { isAdmin } = permissionsFor(club.role);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (isBlank(value)) {
      setProblem(true);
      setSignal((n) => n + 1);
      return;
    }
    setProblem(false);
    setFailed(false);
    if (value.trim() === club.name) {
      setDraft(null);
      toast.success(t("club.name.saved"));
      return;
    }
    setSaving(true);
    try {
      await apiPatch(`/api/clubs/${club.id}`, { name: value.trim() });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["club", club.id] }),
        qc.invalidateQueries({ queryKey: ["clubs"] }),
      ]);
      setDraft(null);
      toast.success(t("club.name.saved"));
    } catch {
      setFailed(true);
      setSignal((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  const errors = problem
    ? [{ fieldId: "cl-name", message: t("club.name.error") }]
    : failed
      ? [{ fieldId: "cl-name", message: t("club.name.failed") }]
      : [];

  return (
    <section className="ap-panel" aria-labelledby="cl-name-h">
      <div className="ap-panel-head">
        <div>
          <h2 className="t-h2" id="cl-name-h">
            {t("club.name.title")}
          </h2>
          <p>{t("club.name.text")}</p>
        </div>
      </div>
      <form className="ap-stack" noValidate onSubmit={(e) => void submit(e)}>
        <ErrorSummary title={t("club.name.errorSummary")} errors={errors} focusSignal={signal} />
        <div className="ap-row" style={{ alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Field
              id="cl-name"
              label={t("club.name.label")}
              required
              error={problem ? t("club.name.error") : undefined}
            >
              <TextInput
                value={value}
                maxLength={255}
                autoComplete="off"
                readOnly={!isAdmin}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setProblem(false);
                  setFailed(false);
                }}
              />
            </Field>
          </div>
          {isAdmin && (
            <Button type="submit" variant="secondary" loading={saving}>
              {t("club.name.save")}
            </Button>
          )}
        </div>
      </form>
      <UnsavedChangesDialog {...unsaved.dialog} />
    </section>
  );
}
