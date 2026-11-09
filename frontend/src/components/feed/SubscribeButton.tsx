import { useTranslation } from "react-i18next";
import { helpPath } from "@/docs/paths";
import { detectPlatform } from "@/lib/platform";
import { googleCalendarUrl, outlookCalendarUrl, type PublicAddresses } from "@/lib/feeds/public";
import { SplitButton, toast } from "@/components/ui/shared";
import type { FeedAccountAction } from "./useFeedAccount";

/**
 * "Kalender abonnieren" split button of the public feed page: opens the calendar app (webcal),
 * Google / Outlook, copies or downloads the ICS address; the default depends on the platform.
 */
export function SubscribeButton({
  addresses,
  name,
  account,
}: {
  addresses: PublicAddresses;
  name: string;
  /** Entry "Zu meinem Konto hinzufügen" / "In meinem Konto anzeigen"; may replace the main action. */
  account?: FeedAccountAction | null;
}) {
  const { t } = useTranslation();
  const platform = detectPlatform();

  const actions = {
    app: () => window.location.assign(addresses.webcal),
    google: () => window.open(googleCalendarUrl(addresses.webcal), "_blank", "noopener"),
    outlook: () => window.open(outlookCalendarUrl(addresses.ics, name), "_blank", "noopener"),
    copy: async () => {
      try {
        await navigator.clipboard.writeText(addresses.ics);
        toast.success(t("feed.subscribeMenu.copied"));
      } catch {
        toast.error(t("feed.subscribeMenu.copyFailed"));
      }
    },
    download: () => {
      const a = document.createElement("a");
      a.href = addresses.ics;
      a.download = "";
      a.click();
    },
  };
  const defaultAction =
    platform === "ios" || platform === "macos" ? "app" : platform === "android" ? "google" : "copy";

  const accountFirst = account?.primary === true;
  const accountItem = account
    ? [{ key: "account", icon: "user" as const, label: account.label, onSelect: account.run }]
    : [];

  return (
    <SplitButton
      className="pub-subscribe"
      icon={accountFirst ? "user" : "rss"}
      label={accountFirst ? account.label : t("feed.subscribe")}
      menuLabel={t("feed.subscribeMenu.label")}
      onClick={accountFirst ? account.run : actions[defaultAction]}
      items={[
        ...(accountFirst
          ? [
              {
                key: "subscribe",
                icon: "rss" as const,
                label: t("feed.subscribe"),
                onSelect: actions[defaultAction],
              },
            ]
          : accountItem),
        { key: "app", icon: "calendar", label: t("feed.subscribeMenu.app"), onSelect: actions.app },
        {
          key: "google",
          icon: "external",
          label: t("feed.subscribeMenu.google"),
          onSelect: actions.google,
        },
        {
          key: "outlook",
          icon: "external",
          label: t("feed.subscribeMenu.outlook"),
          onSelect: actions.outlook,
        },
        { key: "copy", icon: "copy", label: t("feed.subscribeMenu.copy"), onSelect: actions.copy },
        {
          key: "download",
          icon: "download",
          label: t("feed.subscribeMenu.download"),
          onSelect: actions.download,
        },
        {
          key: "help",
          icon: "info",
          label: t("feed.subscribeMenu.help"),
          to: helpPath("publishing/subscribe"),
        },
      ]}
    />
  );
}
