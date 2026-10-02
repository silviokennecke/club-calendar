import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "./ConfirmDialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  /** Overrides the default sentence (e.g. names the edited item). */
  description?: ReactNode;
}

/** "Änderungen verwerfen?" – use with `useUnsavedChanges()` from `@/lib/useUnsavedChanges`. */
export function UnsavedChangesDialog({
  open,
  onCancel,
  onConfirm,
  description,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && onCancel()}
      icon="alert"
      title={t("ui.unsaved.title")}
      description={description ?? t("ui.unsaved.text")}
      consequence={t("ui.unsaved.consequence")}
      confirmLabel={t("ui.unsaved.confirm")}
      cancelLabel={t("ui.unsaved.cancel")}
      onConfirm={onConfirm}
    />
  );
}
