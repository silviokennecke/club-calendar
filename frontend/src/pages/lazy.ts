import { lazy } from "react";

// Route-level code splitting: every page and routed modal is its own chunk, the entry chunk only
// holds the router, providers, app shell and shared building blocks. Navigations run in a React
// transition (RouterProvider), so the previous page stays visible until the next chunk is loaded;
// only the very first load shows the Suspense fallback (BackgroundRoutes, AppShell). Dialogs show
// their loading state inside the opened dialog (ModalFrame).

const modalImports = {
  EventNewModal: () => import("./events/EventNewModal"),
  EventFormModal: () => import("./events/EventFormModal"),
  EventTemplatePickModal: () => import("./events/EventTemplatePickModal"),
  EventFromTemplateModal: () => import("./events/EventFromTemplateModal"),
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

export const LoginPage = lazy(() => import("./LoginPage"));
export const SignupPage = lazy(() => import("./SignupPage"));
export const ForgotPasswordPage = lazy(() => import("./ForgotPasswordPage"));
export const AuthCallbackPage = lazy(() => import("./AuthCallbackPage"));
export const EmailVerifyPage = lazy(() => import("./EmailVerifyPage"));
export const FeedPage = lazy(() => import("./FeedPage"));
export const PublicEventModal = lazy(modalImports.PublicEventModal);
export const ClubsPage = lazy(() => import("./ClubsPage"));
export const SetupPage = lazy(() => import("./SetupPage"));
export const ProfilePage = lazy(() => import("./ProfilePage"));
export const ClubPage = lazy(() => import("./ClubPage"));
export const CalendarPage = lazy(() => import("./CalendarPage"));
export const EventsListPage = lazy(() => import("./events/EventsListPage"));
export const EventNewModal = lazy(modalImports.EventNewModal);
export const EventFormModal = lazy(modalImports.EventFormModal);
export const EventTemplatePickModal = lazy(modalImports.EventTemplatePickModal);
export const EventFromTemplateModal = lazy(modalImports.EventFromTemplateModal);
export const EventsExportPage = lazy(() => import("./events/EventsExportPage"));
export const ImportPage = lazy(() => import("./ImportPage"));
export const TemplatesPage = lazy(() => import("./TemplatesPage"));
export const TemplateEditPage = lazy(() => import("./TemplateEditPage"));
export const MorePage = lazy(() => import("./MorePage"));
export const CalendarSettingsPage = lazy(() => import("./settings/CalendarSettingsPage"));
export const FeedsPage = lazy(() => import("./settings/FeedsPage"));
export const FeedEditPage = lazy(() => import("./settings/FeedEditPage"));
export const PropertiesPage = lazy(() => import("./settings/PropertiesPage"));
export const FeaturesPage = lazy(() => import("./settings/FeaturesPage"));
export const LocationsPage = lazy(() => import("./settings/LocationsPage"));
export const TargetGroupsPage = lazy(() => import("./settings/TargetGroupsPage"));
export const HolidayCalendarsPage = lazy(() => import("./settings/HolidayCalendarsPage"));
