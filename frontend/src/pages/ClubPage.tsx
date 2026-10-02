import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api";
import type { Calendar, Club, User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  SectionHeader,
  ListCard,
  ListRow,
  ConfirmDialog,
  buttonClass,
} from "@/components/ui/shared";
import { CalendarDays, Check, Plus, Archive, ArchiveRestore, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

function formatArchivedAt(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function ClubPage() {
  const { t } = useTranslation();
  const { clubId } = useParams<{ clubId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [newCalName, setNewCalName] = useState("");
  const [calDialogOpen, setCalDialogOpen] = useState(false);
  const [clubName, setClubName] = useState("");
  const [nameSaved, setNameSaved] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [confirmDeleteCalId, setConfirmDeleteCalId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const { data: club } = useQuery<Club>({
    queryKey: ["club", clubId],
    queryFn: () => apiGet<Club>(`/api/clubs/${clubId}`),
  });
  useEffect(() => {
    if (club) setClubName(club.name);
  }, [club]);

  const { data: members = [] } = useQuery<User[]>({
    queryKey: ["members", clubId],
    queryFn: () => apiGet<User[]>(`/api/clubs/${clubId}/members`),
  });

  const { data: calendars = [] } = useQuery<Calendar[]>({
    queryKey: ["calendars", clubId, "all"],
    queryFn: () => apiGet<Calendar[]>(`/api/clubs/${clubId}/calendars?includeArchived=true`),
  });

  const activeCalendars = calendars.filter((c) => !c.archivedAt);
  const archivedCalendars = calendars.filter((c) => !!c.archivedAt);

  async function handleSaveClubName() {
    if (!clubName.trim() || clubName === club?.name) return;
    setNameSaving(true);
    try {
      await apiPatch(`/api/clubs/${clubId}`, { name: clubName.trim() });
      qc.invalidateQueries({ queryKey: ["club", clubId] });
      qc.invalidateQueries({ queryKey: ["clubs"] });
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } finally {
      setNameSaving(false);
    }
  }

  async function handleAddMember() {
    if (!newMemberEmail.trim()) return;
    setAddingMember(true);
    setMemberError("");
    try {
      await apiPost(`/api/clubs/${clubId}/members`, { email: newMemberEmail.trim() });
      setNewMemberEmail("");
      qc.invalidateQueries({ queryKey: ["members", clubId] });
    } catch (e: unknown) {
      setMemberError((e as Error).message ?? "User not found");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    await apiDelete(`/api/clubs/${clubId}/members/${userId}`);
    qc.invalidateQueries({ queryKey: ["members", clubId] });
  }

  async function handleDeleteCalendar(calendarId: string) {
    await apiDelete(`/api/clubs/${clubId}/calendars/${calendarId}`);
    setConfirmDeleteCalId(null);
    qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
  }

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return;
    const cal = await apiPost<Calendar>(`/api/clubs/${clubId}/calendars`, {
      name: newCalName.trim(),
    });
    setNewCalName("");
    setCalDialogOpen(false);
    qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
    navigate(`/clubs/${clubId}/calendars/${cal.id}`);
  }

  async function handleArchive(calendarId: string) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/archive`, {});
    qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
  }

  async function handleUnarchive(calendarId: string) {
    await apiPost(`/api/clubs/${clubId}/calendars/${calendarId}/unarchive`, {});
    qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
  }

  async function handleDuplicate(calendarId: string) {
    setDuplicatingId(calendarId);
    try {
      const newCal = await apiPost<Calendar>(
        `/api/clubs/${clubId}/calendars/${calendarId}/duplicate`,
        {},
      );
      qc.invalidateQueries({ queryKey: ["calendars", clubId, "all"] });
      navigate(`/clubs/${clubId}/calendars/${newCal.id}`);
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDeleteClub() {
    await apiDelete(`/api/clubs/${clubId}`);
    qc.invalidateQueries({ queryKey: ["clubs"] });
    navigate("/clubs", { replace: true });
  }

  function CalendarCard({ cal, archived = false }: { cal: Calendar; archived?: boolean }) {
    if (confirmDeleteCalId === cal.id) {
      return (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm text-red-700">
            {t("common.delete")} <strong>{cal.name}</strong>?
          </span>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => handleDeleteCalendar(cal.id)}
              className="rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
            >
              {t("common.delete")}
            </button>
            <button
              onClick={() => setConfirmDeleteCalId(null)}
              className="rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`overflow-hidden rounded-xl border bg-white ${archived ? "border-slate-100 opacity-70" : "border-slate-200"}`}
      >
        <div className="flex items-center gap-2 px-4 py-3 transition-colors hover:bg-slate-50">
          {archived ? (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-500">
                  {cal.name}
                </span>
                <span className="text-xs text-slate-400">
                  {t("club.archived")} · {formatArchivedAt(cal.archivedAt!)}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => navigate(`/clubs/${clubId}/calendars/${cal.id}`)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate text-sm font-medium text-slate-900">{cal.name}</span>
            </button>
          )}

          <div className="flex shrink-0 items-center gap-1">
            {archived ? (
              <button
                onClick={() => handleUnarchive(cal.id)}
                title="Unarchive"
                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleDuplicate(cal.id)}
                  disabled={duplicatingId === cal.id}
                  title="Duplicate"
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleArchive(cal.id)}
                  title="Archive"
                  className="rounded p-1.5 text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-500"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => setConfirmDeleteCalId(cal.id)}
              className="rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg p-6">
      <h2 className="mb-4 text-base font-semibold text-slate-900">{t("club.title")}</h2>
      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-5">
        <Field label={t("club.clubName")}>
          {(control) => (
            <div className="flex gap-2">
              <Input
                {...control}
                value={clubName}
                onChange={(e) => setClubName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveClubName()}
              />
              <Button
                size="sm"
                disabled={nameSaving || !clubName.trim() || clubName === club?.name}
                onClick={handleSaveClubName}
                className="gap-1.5"
              >
                {nameSaved ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    {t("club.saved")}
                  </>
                ) : nameSaving ? (
                  t("club.saving")
                ) : (
                  t("club.save")
                )}
              </Button>
            </div>
          )}
        </Field>
      </div>

      <div className="mb-10">
        <ConfirmDialog
          trigger={
            <button type="button" className={buttonClass("danger")}>
              {t("club.deleteThisClub")}
            </button>
          }
          title={t("club.deleteClubTitle", { name: club?.name ?? "" })}
          description={t("club.deleteClubConfirm")}
          consequence={t("club.deleteClubConsequence", { count: calendars.length })}
          confirmLabel={t("club.deleteClub")}
          onConfirm={handleDeleteClub}
        />
      </div>

      <h2 className="mb-4 text-base font-semibold text-slate-900">{t("club.members")}</h2>
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="user@example.com"
          value={newMemberEmail}
          onChange={(e) => setNewMemberEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
        />
        <Button size="sm" disabled={addingMember} onClick={handleAddMember}>
          {t("club.addMember")}
        </Button>
      </div>
      {memberError && <p className="mb-3 text-sm text-red-500">{memberError}</p>}
      <ListCard
        items={members}
        emptyMessage={t("club.noMembers")}
        className="mb-10"
        renderItem={(m: User) => (
          <ListRow
            title={m.name}
            subtitle={m.email}
            actions={
              <button
                onClick={() => handleRemoveMember(m.id)}
                className="rounded px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                {t("club.removeMember")}
              </button>
            }
          />
        )}
      />

      <SectionHeader
        title={t("club.calendars")}
        className="mb-4"
        action={
          <Dialog open={calDialogOpen} onOpenChange={setCalDialogOpen}>
            <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
              <Plus className="h-3.5 w-3.5" />
              {t("club.newCalendarButton")}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("club.createCalendar")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder={t("club.calendarNamePlaceholder")}
                  value={newCalName}
                  onChange={(e) => setNewCalName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreateCalendar()}
                  autoFocus
                />
                <Button className="w-full" onClick={handleCreateCalendar}>
                  {t("common.create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-2">
        {activeCalendars.length === 0 && archivedCalendars.length === 0 && (
          <p className="py-4 text-sm text-slate-400">{t("club.noCalendars")}</p>
        )}
        {activeCalendars.map((cal) => (
          <CalendarCard key={cal.id} cal={cal} />
        ))}
      </div>

      {archivedCalendars.length > 0 && (
        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            {t("club.archived")}
          </p>
          {archivedCalendars.map((cal) => (
            <CalendarCard key={cal.id} cal={cal} archived />
          ))}
        </div>
      )}
    </div>
  );
}
