import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  IconButton,
  Skeleton,
  Tag,
  TextInput,
  toast,
  type Glyph,
} from "@/components/ui/shared";
import { audienceTone } from "@/components/calendar/eventDisplay";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { CalendarEvent, EventTemplate } from "@/lib/types";
import {
  MASTER_KINDS,
  countUsage,
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
  calendarId: string;
  /** Archived calendars: list only, no add / rename / delete. */
  readOnly?: boolean;
}

/**
 * One building block for properties, features and audiences (design: SettingsMasterList): add form,
 * list with inline rename (Enter saves, Escape cancels), delete with the consequences for events
 * and templates, empty / loading / error states.
 */
export function MasterList({ kind, calendarId, readOnly }: MasterListProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const cfg = MASTER_KINDS[kind];
  const tk = (key: string, opts?: Record<string, unknown>) =>
    t(`settings.master.${kind}.${key}`, opts);
  const base = `/api/calendars/${calendarId}/${cfg.path}`;
  const queryKey = [cfg.queryKey, calendarId];

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

  // Inline rename
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editProblem, setEditProblem] = useState<NameProblem | null>(null);
  const [editSignal, setEditSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editFailed, setEditFailed] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState<MasterItem | null>(null);
  const usage = useQuery({
    queryKey: ["usage", cfg.queryKey, calendarId],
    enabled: !!deleting,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      const [events, templates] = await Promise.all([
        apiGet<CalendarEvent[]>(`/api/calendars/${calendarId}/events`),
        apiGet<EventTemplate[]>(`/api/calendars/${calendarId}/templates`),
      ]);
      return { events, templates };
    },
  });

  const problemText = (p: NameProblem) => t(`settings.master.problem.${p}`);

  function focusLater(id: string) {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }

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
    } catch {
      setAddFailed(true);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(item: MasterItem) {
    setEditId(item.id);
    setEditName(item.name);
    setEditIcon(item.icon ?? "");
    setEditProblem(null);
    setEditFailed(false);
    focusLater(`ml-edit-${item.id}`);
  }

  function stopEdit(id: string) {
    setEditId(null);
    setEditProblem(null);
    setEditFailed(false);
    focusLater(`ml-edit-btn-${id}`);
  }

  async function submitEdit(e: FormEvent, item: MasterItem) {
    e.preventDefault();
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
      void qc.invalidateQueries({ queryKey: ["events", calendarId] });
      void qc.invalidateQueries({ queryKey: ["templates", calendarId] });
      toast.success(t("settings.master.saved"));
      stopEdit(item.id);
    } catch {
      setEditFailed(true);
    } finally {
      setSaving(false);
    }
  }

  function onEditKeyDown(e: KeyboardEvent, item: MasterItem) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stopEdit(item.id);
    }
  }

  async function confirmDelete(item: MasterItem) {
    try {
      await apiDelete(`${base}/${item.id}`);
      await qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: ["events", calendarId] });
      void qc.invalidateQueries({ queryKey: ["templates", calendarId] });
      if (editId === item.id) setEditId(null);
      toast.success(tk("deleted", { name: item.name }));
      setTimeout(() => headingRef.current?.focus(), 0);
    } catch {
      toast.error(tk("deleteFailed", { name: item.name }));
    }
  }

  function consequence(item: MasterItem) {
    if (usage.isError) return tk("consequence.unknown", { name: item.name });
    if (!usage.data) return tk("consequence.loading");
    const n = countUsage(kind, item.id, usage.data.events, usage.data.templates);
    const parts: string[] = [];
    if (n.events > 0) parts.push(tk("consequence.events", { count: n.events, name: item.name }));
    if (n.templates > 0) parts.push(tk("consequence.templates", { count: n.templates }));
    return parts.length > 0 ? parts.join(" ") : tk("consequence.none", { name: item.name });
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
              <Button icon="plus" onClick={() => addInputRef.current?.focus()}>
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
        {items.map((item, index) =>
          editId === item.id ? (
            <li key={item.id} className="ap-listrow ap-listrow--edit">
              <form
                className="ap-form ap-grow"
                noValidate
                onSubmit={(e) => void submitEdit(e, item)}
                onKeyDown={(e) => onEditKeyDown(e, item)}
                aria-label={tk("editTitle", { name: item.name })}
              >
                <ErrorSummary
                  title={t("settings.master.errorSummary")}
                  errors={
                    editProblem
                      ? [{ fieldId: `ml-edit-${item.id}`, message: problemText(editProblem) }]
                      : []
                  }
                  focusSignal={editSignal}
                />
                {editFailed && <Banner tone="danger">{t("settings.master.saveFailed")}</Banner>}
                <Field
                  id={`ml-edit-${item.id}`}
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
                <div className="ap-actions">
                  <Button type="submit" loading={saving}>
                    {t("settings.master.saveEdit")}
                  </Button>
                  <Button variant="secondary" onClick={() => stopEdit(item.id)} disabled={saving}>
                    {t("common.cancel")}
                  </Button>
                </div>
              </form>
            </li>
          ) : (
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
                    onClick={() => setDeleting(item)}
                  />
                </>
              )}
            </li>
          ),
        )}
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

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          icon="trash"
          title={tk("deleteTitle", { name: deleting.name })}
          description={tk("deleteText", { name: deleting.name })}
          consequence={consequence(deleting)}
          confirmLabel={tk("deleteConfirm")}
          onConfirm={() => confirmDelete(deleting)}
        />
      )}
    </div>
  );
}
