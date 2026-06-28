import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { FullPageLoader } from "@/components/ui/shared";
import type { Club } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function ClubsPage() {
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [redirected, setRedirected] = useState(false);
  const [newClubName, setNewClubName] = useState("");
  const [open, setOpen] = useState(false);

  const {
    data: clubs = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
  });

  useEffect(() => {
    if (isLoading || redirected) return;
    if (user?.lastClubId && user?.lastCalendarId) {
      const clubExists = clubs.some((c) => c.id === user.lastClubId);
      if (clubs.length > 0 && clubExists) {
        setRedirected(true);
        navigate(`/clubs/${user.lastClubId}/calendars/${user.lastCalendarId}`, { replace: true });
        return;
      }
    }
    if (!isLoading && clubs.length === 0) {
      setRedirected(true);
      navigate("/setup", { replace: true });
    }
  }, [user, clubs, isLoading, redirected, navigate]);

  async function handleCreate() {
    if (!newClubName.trim()) return;
    await apiPost("/api/clubs", { name: newClubName, timezone: "Europe/Berlin" });
    setNewClubName("");
    setOpen(false);
    refetch();
  }

  if (isLoading || redirected) return <FullPageLoader />;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <span className="text-lg font-semibold text-slate-900">📅 Club Calendar</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={logout}>
            {t("auth.signOut")}
          </Button>
        </div>
      </div>
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t("clubs.selectClub")}</h1>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button size="sm" />}>{t("clubs.newClub")}</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("clubs.createClubTitle")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <Input
                  placeholder={t("clubs.clubName")}
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <Button className="w-full" onClick={handleCreate}>
                  {t("clubs.create")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <Card
              key={club.id}
              className="cursor-pointer border-slate-200 transition-colors hover:border-slate-300 hover:bg-slate-50"
              onClick={() => navigate(`/clubs/${club.id}`)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{club.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500">{club.timezone}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
