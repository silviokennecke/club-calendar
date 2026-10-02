import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet, apiPatch, apiDelete, apiFetch } from "@/lib/api";
import { DATE_FORMAT_OPTIONS } from "@/lib/dateFormat";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, ConfirmDialog, LangSwitch, buttonClass } from "@/components/ui/shared";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { Trash2, Plus, Key } from "lucide-react";

interface PasskeyInfo {
  id: string;
  deviceName: string;
  createdAt: string;
}
interface ProfileData {
  id: number;
  name: string;
  email: string;
  dateFormat: string;
  firstDayOfWeek: number;
  passkeys: PasskeyInfo[];
  oauthAccounts: { provider: string }[];
}

export default function ProfilePage() {
  const { user, logout, updateUser } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [deviceName, setDeviceName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState("");

  const { data: profile, refetch } = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () => apiGet("/api/auth/me"),
  });

  async function handleRegisterPasskey() {
    setRegistering(true);
    setMessage("");
    try {
      const { startRegistration } = await import("@simplewebauthn/browser");
      const optRes = await apiFetch("/api/auth/webauthn/register/options");

      const { options, challengeToken } = (await optRes.json()) as {
        options: any;
        challengeToken: string;
      };
      const response = await startRegistration({ optionsJSON: options });
      const verifyRes = await apiFetch("/api/auth/webauthn/register/verify", {
        method: "POST",
        body: JSON.stringify({ challengeToken, response, deviceName: deviceName || "My device" }),
      });
      if (!verifyRes.ok) {
        setMessage(t("profile.registrationFailed"));
        return;
      }
      setMessage(t("profile.passkeyRegistered"));
      setDeviceName("");
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("cancel")) setMessage(t("profile.registrationFailedOrCancelled"));
    } finally {
      setRegistering(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    await apiDelete(`/api/auth/webauthn/${id}`);
    refetch();
  }

  async function handleDeleteAccount() {
    await apiDelete("/api/auth/me");
    logout();
    navigate("/login", { replace: true });
  }

  void user;

  return (
    <div className="max-w-lg p-6">
      <h2 className="mb-6 text-base font-semibold text-slate-900">{t("profile.title")}</h2>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5">
        <p className="text-sm font-medium text-slate-900">{profile?.name}</p>
        <p className="text-sm text-slate-500">{profile?.email}</p>
        {profile?.oauthAccounts?.map((a) => (
          <Badge key={a.provider} variant="secondary" className="mt-2 mr-1 text-xs capitalize">
            {a.provider}
          </Badge>
        ))}
      </div>

      <div className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <Key className="h-4 w-4" />
          {t("profile.passkeys")}
        </h3>
        <p className="text-xs text-slate-500">{t("profile.passkeyDescription")}</p>

        {profile?.passkeys?.map((pk) => (
          <div
            key={pk.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3"
          >
            <div>
              <p className="text-sm font-medium text-slate-900">{pk.deviceName}</p>
              <p className="text-xs text-slate-400">
                {t("profile.addedOn", { date: new Date(pk.createdAt).toLocaleDateString() })}
              </p>
            </div>
            <button
              onClick={() => handleDeletePasskey(pk.id)}
              className="rounded p-1.5 text-slate-400 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <div className="mt-2 flex gap-2">
          <Input
            placeholder={t("profile.deviceName")}
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            disabled={registering}
            onClick={handleRegisterPasskey}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {registering ? t("profile.waiting") : t("profile.addPasskey")}
          </Button>
        </div>
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">{t("profile.localization")}</h3>
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <Field label={t("profile.dateFormat")}>
            <select
              className="cc-input"
              value={profile?.dateFormat ?? "dd.MM.yyyy"}
              onChange={async (e) => {
                await apiPatch("/api/auth/me", { dateFormat: e.target.value });
                refetch();
              }}
            >
              {DATE_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          <Field group label={t("profile.firstDayOfWeek")}>
            <div className="flex gap-2">
              {(
                [
                  { label: t("profile.monday"), value: 1 },
                  { label: t("profile.sunday"), value: 0 },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={(profile?.firstDayOfWeek ?? 1) === opt.value}
                  onClick={async () => {
                    await apiPatch("/api/auth/me", { firstDayOfWeek: opt.value });
                    refetch();
                  }}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${(profile?.firstDayOfWeek ?? 1) === opt.value ? "border-blue-300 bg-blue-50 font-medium text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300"}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Field>

          <Field group label={t("profile.language")}>
            <LangSwitch onChange={(language) => updateUser({ language })} />
          </Field>

          <Field group label={t("ui.theme.label")}>
            <div className="ap-seg" role="group" aria-label={t("ui.theme.label")}>
              {(["light", "dark", "system"] as ThemePreference[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={theme === option}
                  onClick={() => setTheme(option)}
                >
                  {t(`ui.theme.${option}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </div>

      <div className="mt-8 border-t border-slate-200 pt-6">
        <h3 className="mb-3 text-sm font-semibold text-red-600">{t("profile.dangerZone")}</h3>
        <ConfirmDialog
          trigger={
            <button type="button" className={buttonClass("danger")}>
              {t("profile.deleteAccount")}
            </button>
          }
          title={t("profile.deleteAccountTitle")}
          description={t("profile.deleteAccountConfirm")}
          consequence={t("profile.deleteAccountConsequence")}
          confirmLabel={t("profile.deleteAccountButton")}
          onConfirm={handleDeleteAccount}
        />
      </div>
    </div>
  );
}
