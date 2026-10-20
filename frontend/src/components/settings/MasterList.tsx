import { useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Banner,
  Button,
  ConfirmDialog,
  EmojiPicker,
  EmptyState,
  ErrorSummary,
  Field,
  FormDialog,
  IconButton,
  Skeleton,
  Tag,
  TextInput,
  UnsavedChangesDialog,
  toast,
  type Glyph,
} from "@/components/ui/shared";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { apiDelete, apiGet, apiPatch, apiPost, isDuplicateNameError } from "@/lib/api";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  MASTER_KINDS,
  masterConsequence,
  validateName,
  type MasterItem,
  type MasterKind,
  type NameProblem,
} from "@/lib/settings";

const GLYPHS: Record<MasterKind, Glyph> = {
  properties: "tag",
  features: "layers",
  audiences: "users",
};

interface MasterListProps {
  kind: MasterKind;
  clubId: string;
  /** Owner of properties / features; audiences belong to the club and need none. */
  calendarId?: string;
  /** Archived calendars: list only, no add / rename / delete. */
  readOnly?: boolean;
}

/**
 * One building block for properties, features and audiences (design: SettingsMasterList): add form,
 * list, rename in a dialog (Enter saves, Escape cancels, focus returns to the edit button), delete with
 * the consequences for events and templates, empty / loading / error states.
 */
export function MasterList({ kind, clubId, calendarId, readOnly }: MasterListProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = MASTER_KINDS[kind];
  const tk = (key: string, opts?: Record<string, unknown>) =>
    t(`settings.master.${kind}.${key}`, opts);
  // Audiences belong to the club (shared by all its calendars), properties / features to the calendar.
  const ownerId = cfg.owner === "clubs" ? clubId : (calendarId ?? "");
  const base = `/api/${cfg.owner}/${ownerId}/${cfg.path}`;
  const queryKey = [cfg.queryKey, ownerId];
  // Renaming / deleting a club-wide item changes the events and templates of every calendar.
  const usageScope = cfg.owner === "clubs" || !calendarId ? [] : [calendarId];

  const list = useQuery<MasterItem[]>({ queryKey, queryFn: () => apiGet<MasterItem[]>(base) });
  const items = list.data ?? [];

  // Add form
  const [draft, setDraft] = useState("");
  const [draftIcon, setDraftIcon] = useState("");
  const [addProblem, setAddProblem] = useState<NameProblem | null>(null);
  const [addSignal, setAddSignal] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addFailed, setAddFailed] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Rename dialog
  const [editing, setEditing] = useState<MasterItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editProblem, setEditProblem] = useState<NameProblem | null>(null);
  const [editSignal, setEditSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editFailed, setEditFailed] = useState(false);
  // Dirty-only guards for the inline add form and the edit dialog (separate: cancelling the
  // dialog must not ask about a half-typed new entry and vice versa).
  const addGuard = useUnsavedChanges(!readOnly && (draft.trim() !== "" || draftIcon !== ""));
  const editGuard = useUnsavedChanges(
    !!editing && (editName !== editing.name || editIcon !== (editing.icon ?? "")),
  );

  // Delete: the consequences come from the list's `usage` (counted by the backend), refreshed when the
  // dialog opens so that events created meanwhile are counted.
  const [deleting, setDeleting] = useState<MasterItem | null>(null);
  function openDelete(item: MasterItem) {
    setDeleting(item);
    void list.refetch();
  }

  const problemText = (p: NameProblem) => t(`settings.master.problem.${p}`);

  async function submitAdd(e: FormEvent) {
    e.preventDefault();
    const problem = validateName(draft, items);
    setAddFailed(false);
    if (problem) {
      setAddProblem(problem);
      setAddSignal((n) => n + 1);
      return;
    }
    setAddProblem(null);
    setAdding(true);
    const name = draft.trim();
    try {
      await apiPost(base, cfg.hasSymbol ? { name, icon: draftIcon || null } : { name });
      await qc.invalidateQueries({ queryKey });
      setDraft("");
      setDraftIcon("");
      toast.success(tk("created", { name }));
      addInputRef.current?.focus();
    } catch (error) {
      // Someone else added the name meanwhile: the backend rejects duplicates per calendar.
      if (isDuplicateNameError(error)) {
        setAddProblem("duplicate");
        setAddSignal((n) => n + 1);
        void qc.invalidateQueries({ queryKey });
      } else setAddFailed(true);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: MasterItem) {
    setEditing(item);
    setEditName(item.name);
    setEditIcon(item.icon ?? "");
    setEditProblem(null);
    setEditFailed(false);
  }

  function stopEdit() {
    if (saving) return;
    setEditing(null);
    setEditProblem(null);
    setEditFailed(false);
  }

  async function submitEdit() {
    if (!editing) return;
    const item = editing;
    const problem = validateName(editName, items, item.id);
    setEditFailed(false);
    if (problem) {
      setEditProblem(problem);
      setEditSignal((n) => n + 1);
      return;
    }
    setSaving(true);
    try {
      const name = editName.trim();
      await apiPatch(
        `${base}/${item.id}`,
        cfg.hasSymbol ? { name, icon: editIcon || null } : { name },
      );
      await qc.invalidateQueries({ queryKey });
      // Events and templates show the name and symbol.
      void qc.invalidateQueries({ queryKey: ["events", ...usageScope] });
      void qc.invalidateQueries({ queryKey: ["templates", ...usageScope] });
      toast.success(t("settings.master.saved"));
      setEditing(null);
    } catch (error) {
      if (isDuplicateNameError(error)) {
        setEditProblem("duplicate");
        void qc.invalidateQueries({ queryKey });
      } else setEditFailed(true);
      setEditSignal((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete(item: MasterItem) {
    try {
      await apiDelete(`${base}/${item.id}`);
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["events", ...usageScope] });
      void qc.invalidateQueries({ queryKey: ["templates", ...usageScope] });
      toast.success(tk("deleted", { name: item.name }));
      setTimeout(() => headingRef.current?.focus(), 0);
    } catch {
      toast.error(tk("deleteFailed", { name: item.name }));
    }
  }

  /** Design (Dialogs.dc.html): "Bei 2 Terminen (A, B) wird die Zuordnung entfernt. …"; audiences add the feeds. */
  function consequence(item: MasterItem) {
    const current = items.find((i) => i.id === item.id) ?? item;
    if (list.isFetching && !current.usage) return tk("consequence.loading");
    return masterConsequence(kind, current, tk);
  }

  const addErrors = addProblem
    ? [{ fieldId: "ml-add-name", message: problemText(addProblem) }]
    : [];

  let listContent;
  if (list.isLoading) {
    listContent = (
      <div className="ap-stack" aria-busy="true">
        <p className="ap-sr" role="status">
          {t("settings.master.loading")}
        </p>
        <Skeleton style={{ display: "block", height: 56 }} />
        <Skeleton style={{ display: "block", height: 56 }} />
      </div>
    );
  } else if (list.isError && !list.data) {
    listContent = (
      <Banner
        tone="danger"
        title={t("settings.master.loadError.title")}
        action={
          <Button variant="secondary" icon="refresh" onClick={() => void list.refetch()}>
            {t("settings.master.loadError.retry")}
          </Button>
        }
      >
        {tk("loadError")}
      </Banner>
    );
  } else if (items.length === 0) {
    listContent = (
      <div className="ap-panel">
        <EmptyState
          icon={GLYPHS[kind]}
          title={tk("emptyTitle")}
          text={readOnly ? tk("emptyReadOnly") : tk("emptyText")}
          actions={
            readOnly ? undefined : (
              <Button variant="secondary" icon="plus" onClick={() => addInputRef.current?.focus()}>
                {tk("create")}
              </Button>
            )
          }
        />
      </div>
    );
  } else {
    listContent = (
      <ul className="ap-panel ap-panel--flush ap-list" aria-labelledby={`ml-list-h-${kind}`}>
        {items.map((item, index) => (
          <li key={item.id} className="ap-listrow">
            {cfg.hasSymbol && item.icon && (
              <span className="ap-symbol" aria-hidden="true">
                {item.icon}
              </span>
            )}
            <div className="ap-listrow-main">
              <b>{item.name}</b>
            </div>
            {cfg.hasTone && (
              <span className="ap-row" aria-hidden="true" style={{ gap: "var(--space-2)" }}>
                <span className="t-cap t-muted ap-hide-m">{t("settings.master.preview")}</span>
                <Tag tone={audienceTone(index)}>{item.name}</Tag>
              </span>
            )}
            {!readOnly && (
              <>
                <IconButton
                  id={`ml-edit-btn-${item.id}`}
                  icon="edit"
                  label={tk("editLabel", { name: item.name })}
                  onClick={() => startEdit(item)}
                />
                <IconButton
                  icon="trash"
                  variant="danger"
                  label={tk("deleteLabel", { name: item.name })}
                  onClick={() => openDelete(item)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="ap-stack ap-stack--lg">
      {!readOnly && (
        <section className="ap-panel" aria-labelledby={`ml-add-h-${kind}`}>
          <form className="ap-form" noValidate onSubmit={(e) => void submitAdd(e)}>
            <h2 className="t-h3" id={`ml-add-h-${kind}`}>
              {tk("addTitle")}
            </h2>
            <ErrorSummary
              title={t("settings.master.errorSummary")}
              errors={addErrors}
              focusSignal={addSignal}
            />
            {addFailed && <Banner tone="danger">{tk("createFailed")}</Banner>}
            <Field
              id="ml-add-name"
              label={t("settings.master.nameLabel")}
              required
              error={addProblem ? problemText(addProblem) : undefined}
            >
              <TextInput
                ref={addInputRef}
                value={draft}
                maxLength={255}
                autoComplete="off"
                placeholder={tk("placeholder")}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setAddProblem(null);
                }}
              />
            </Field>
            {cfg.hasSymbol && (
              <EmojiPicker
                label={t("settings.master.symbolLabel")}
                value={draftIcon}
                onChange={setDraftIcon}
              />
            )}
            <div className="ap-actions">
              <Button type="submit" icon="plus" loading={adding}>
                {tk("create")}
              </Button>
            </div>
          </form>
        </section>
      )}

      <section className="ap-stack" aria-labelledby={`ml-list-h-${kind}`}>
        <h2 className="t-h3" id={`ml-list-h-${kind}`} ref={headingRef} tabIndex={-1}>
          {tk("listTitle", { count: items.length })}
        </h2>
        {listContent}
      </section>

      {editing && (
        <FormDialog
          open
          onOpenChange={(open) => !open && editGuard.guard(stopEdit)}
          title={tk("editTitle")}
          description={tk("editText", { name: editing.name })}
          onSubmit={() => void submitEdit()}
          finalFocus={() => document.getElementById(`ml-edit-btn-${editing.id}`)}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => editGuard.guard(stopEdit)}
                disabled={saving}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={saving}>
                {t("settings.master.saveEdit")}
              </Button>
            </>
          }
        >
          <ErrorSummary
            title={t("settings.master.errorSummary")}
            errors={
              editProblem ? [{ fieldId: "ml-edit-name", message: problemText(editProblem) }] : []
            }
            focusSignal={editSignal}
          />
          {editFailed && <Banner tone="danger">{t("settings.master.saveFailed")}</Banner>}
          <Field
            id="ml-edit-name"
            label={t("settings.master.nameLabel")}
            required
            error={editProblem ? problemText(editProblem) : undefined}
          >
            <TextInput
              value={editName}
              maxLength={255}
              autoComplete="off"
              onChange={(e) => {
                setEditName(e.target.value);
                setEditProblem(null);
              }}
            />
          </Field>
          {cfg.hasSymbol && (
            <EmojiPicker
              label={t("settings.master.symbolLabel")}
              value={editIcon}
              onChange={setEditIcon}
            />
          )}
        </FormDialog>
      )}
      <UnsavedChangesDialog {...editGuard.dialog} />
      <UnsavedChangesDialog {...addGuard.dialog} />

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={tk("deleteTitle", { name: deleting.name })}
          description={tk("deleteText")}
          consequence={consequence(deleting)}
          confirmLabel={tk("deleteConfirm")}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </div>
  );
}
