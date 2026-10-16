import { lazy, type ComponentType } from "react";
import { untilReload } from "@/lib/chunkReload";

// Route-level code splitting: every page and routed modal is its own chunk, the entry chunk only
// holds the router, providers, app shell and shared building blocks. Navigations run in a React
// transition (RouterProvider), so the previous page stays visible until the next chunk is loaded;
// only the very first load shows the Suspense fallback (BackgroundRoutes, AppShell). Dialogs show
// their loading state inside the opened dialog (ModalFrame).

/** `React.lazy` for a page chunk; a reload after a failed chunk load (`main.tsx`) leaves it pending. */
function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  return lazy(() => untilReload(load()));
}

const modalImports = {
  EventNewModal: () => import("./events/EventNewModal"),
  EventFormModal: () => import("./events/EventFormModal"),
  EventTemplatePickModal: () => import("./events/EventTemplatePickModal"),
  EventFromTemplateModal: () => import("./events/EventFromTemplateModal"),
  EventSeriesEditModal: () => import("./events/EventSeriesEditModal"),
  PublicEventModal: () => import("./PublicEventModal"),
};

const preloaded = new Set<string>();

function preload(names: (keyof typeof modalImports)[]): () => void {
  // After the page's own requests: a short delay, then the chunks load in the background.
  const timer = setTimeout(() => {
    for (const name of names) {
      if (preloaded.has(name)) continue;
      preloaded.add(name);
      void modalImports[name]().catch(() => preloaded.delete(name));
    }
  }, 1000);
  return () => clearTimeout(timer);
}

/**
 * Loads the event dialogs' chunks in the background, so the first dialog opens without waiting for
 * the network. For pages that open them (calendar, event list, templates): `useEffect(preloadEventModals, [])`.
 */
export function preloadEventModals(): () => void {
  return preload([
    "EventNewModal",
    "EventFormModal",
    "EventTemplatePickModal",
    "EventFromTemplateModal",
  ]);
}

/** Same for the public event dialog above the public feed. */
export function preloadPublicEventModal(): () => void {
  return preload(["PublicEventModal"]);
}

export const LoginPage = lazyPage(() => import("./LoginPage"));
export const SignupPage = lazyPage(() => import("./SignupPage"));
export const ForgotPasswordPage = lazyPage(() => import("./ForgotPasswordPage"));
export const ResetPasswordPage = lazyPage(() => import("./ResetPasswordPage"));
export const AuthCallbackPage = lazyPage(() => import("./AuthCallbackPage"));
export const VerifyCodePage = lazyPage(() => import("./VerifyCodePage"));
export const EmailVerifyPage = lazyPage(() => import("./EmailVerifyPage"));
export const FeedPage = lazyPage(() => import("./FeedPage"));
export const PublicEventModal = lazyPage(modalImports.PublicEventModal);
export const ClubsPage = lazyPage(() => import("./ClubsPage"));
export const SetupPage = lazyPage(() => import("./SetupPage"));
export const ProfilePage = lazyPage(() => import("./ProfilePage"));
export const ClubPage = lazyPage(() => import("./ClubPage"));
export const CalendarPage = lazyPage(() => import("./CalendarPage"));
export const EventsListPage = lazyPage(() => import("./events/EventsListPage"));
export const EventNewModal = lazyPage(modalImports.EventNewModal);
export const EventFormModal = lazyPage(modalImports.EventFormModal);
export const EventTemplatePickModal = lazyPage(modalImports.EventTemplatePickModal);
export const EventFromTemplateModal = lazyPage(modalImports.EventFromTemplateModal);
export const EventSeriesEditModal = lazyPage(modalImports.EventSeriesEditModal);
export const EventsExportPage = lazyPage(() => import("./events/EventsExportPage"));
export const ImportPage = lazyPage(() => import("./ImportPage"));
export const TemplatesPage = lazyPage(() => import("./TemplatesPage"));
export const TemplateEditPage = lazyPage(() => import("./TemplateEditPage"));
export const MorePage = lazyPage(() => import("./MorePage"));
export const CalendarSettingsPage = lazyPage(() => import("./settings/CalendarSettingsPage"));
export const FeedsPage = lazyPage(() => import("./settings/FeedsPage"));
export const FeedEditPage = lazyPage(() => import("./settings/FeedEditPage"));
export const PropertiesPage = lazyPage(() => import("./settings/PropertiesPage"));
export const FeaturesPage = lazyPage(() => import("./settings/FeaturesPage"));
export const LocationsPage = lazyPage(() => import("./settings/LocationsPage"));
export const TargetGroupsPage = lazyPage(() => import("./settings/TargetGroupsPage"));
export const HolidayCalendarsPage = lazyPage(() => import("./settings/HolidayCalendarsPage"));
