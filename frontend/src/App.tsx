import { createBrowserRouter, Navigate, Outlet, Route, RouterProvider } from "react-router-dom";
import { ReactQueryProvider } from "./lib/react-query-provider";
import { useAuth } from "./lib/auth-context";
import { AuthProvider } from "./lib/AuthProvider";
import { ThemeProvider } from "./lib/ThemeProvider";
import { ModalFrame, Toaster } from "./components/ui/shared";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import GuestRoute from "./components/layout/GuestRoute";
import { BackgroundRoutes } from "./components/layout/BackgroundRoutes";
import { LegacyClubSettingsRedirect } from "./components/layout/LegacyClubSettingsRedirect";
import { NotFoundPage, RouteErrorPage } from "./components/error/ErrorPage";

import {
  AuthCallbackPage,
  CalendarPage,
  CalendarSettingsPage,
  ClubPage,
  ClubsPage,
  EmailVerifyPage,
  VerifyCodePage,
  EventFormModal,
  EventFromTemplateModal,
  EventSeriesEditModal,
  EventNewModal,
  EventsExportPage,
  EventsListPage,
  EventTemplatePickModal,
  FeaturesPage,
  FeedEditPage,
  FeedPage,
  HelpSubscribePage,
  FeedsPage,
  ForgotPasswordPage,
  HolidayCalendarsPage,
  ImportPage,
  InvitationPage,
  LegalModal,
  LegalPage,
  LocationsPage,
  LoginPage,
  MorePage,
  ProfilePage,
  PropertiesPage,
  PublicEventModal,
  ResetPasswordPage,
  SetupPage,
  SignupPage,
  TargetGroupsPage,
  TemplateEditPage,
  TemplatesPage,
} from "./pages/lazy";

const CAL = "/clubs/:clubId/calendars/:calendarId";

function AppRoutes() {
  return (
    <BackgroundRoutes
      pages={
        <>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route element={<GuestRoute />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/verify-email" element={<VerifyCodePage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
          {/* Legal documents: standalone pages (the modal variant needs a background page). */}
          <Route path="/imprint" element={<LegalPage />} />
          <Route path="/privacy" element={<LegalPage />} />
          <Route path="/terms" element={<LegalPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/verify-email" element={<EmailVerifyPage />} />
          <Route path="/feed/:feedId" element={<FeedPage />} />
          <Route path="/help/subscribe" element={<HelpSubscribePage />} />
          {/* Handles the signed-out case itself: the token survives the login (sessionStorage). */}
          <Route path="/invitations" element={<InvitationPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/clubs" element={<ClubsPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/clubs/:clubId" element={<ClubPage />} />
            <Route path="/clubs/:clubId/calendars/:calendarId" element={<CalendarPage />} />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/events"
              element={<EventsListPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/events/export"
              element={<EventsExportPage />}
            />
            <Route path="/clubs/:clubId/calendars/:calendarId/import" element={<ImportPage />} />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/templates"
              element={<TemplatesPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/templates/new"
              element={<TemplateEditPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/templates/:templateId"
              element={<TemplateEditPage />}
            />
            <Route path="/clubs/:clubId/calendars/:calendarId/more" element={<MorePage />} />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings"
              element={<CalendarSettingsPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/properties"
              element={<PropertiesPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/features"
              element={<FeaturesPage />}
            />
            {/* Locations, target groups and feeds belong to the club: club settings without a calendar. */}
            <Route path="/clubs/:clubId/settings" element={<Navigate to="locations" replace />} />
            <Route path="/clubs/:clubId/settings/locations" element={<LocationsPage />} />
            <Route path="/clubs/:clubId/settings/target-groups" element={<TargetGroupsPage />} />
            <Route path="/clubs/:clubId/settings/feeds" element={<FeedsPage />} />
            <Route path="/clubs/:clubId/settings/feeds/new" element={<FeedEditPage />} />
            <Route path="/clubs/:clubId/settings/feeds/:feedId" element={<FeedEditPage />} />
            {/* Old calendar-level addresses keep working. */}
            <Route path={`${CAL}/settings/locations`} element={<LegacyClubSettingsRedirect />} />
            <Route
              path={`${CAL}/settings/target-groups`}
              element={<LegacyClubSettingsRedirect />}
            />
            <Route path={`${CAL}/settings/feeds`} element={<LegacyClubSettingsRedirect />} />
            <Route path={`${CAL}/settings/feeds/new`} element={<LegacyClubSettingsRedirect />} />
            <Route
              path={`${CAL}/settings/feeds/:feedId`}
              element={<LegacyClubSettingsRedirect />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/holiday-calendars"
              element={<HolidayCalendarsPage />}
            />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </>
      }
      modals={
        <>
          <Route element={<SignedIn />}>
            <Route element={<ModalFrame />}>
              <Route path={`${CAL}/events/new`} element={<EventNewModal />} />
              <Route path={`${CAL}/events/new/form`} element={<EventFormModal />} />
              <Route path={`${CAL}/events/new/template`} element={<EventTemplatePickModal />} />
              <Route
                path={`${CAL}/events/new/template/:templateId`}
                element={<EventFromTemplateModal />}
              />
              <Route path={`${CAL}/events/:eventId`} element={<EventFormModal />} />
              <Route path={`${CAL}/events/:eventId/series`} element={<EventSeriesEditModal />} />
            </Route>
          </Route>
          <Route element={<ModalFrame />}>
            <Route path="/imprint" element={<LegalModal />} />
            <Route path="/privacy" element={<LegalModal />} />
            <Route path="/terms" element={<LegalModal />} />
            <Route path="/feed/:feedId/events/:eventId" element={<PublicEventModal />} />
          </Route>
        </>
      }
    />
  );
}

/** Modal routes of the app: the background (ProtectedRoute) handles sign-in redirects. */
function SignedIn() {
  const { user, loading } = useAuth();
  // Pending consents lock the app: no event dialogs above the consent gate.
  return !loading && user && !user.consentRequired ? <Outlet /> : null;
}

function Root() {
  return (
    <ReactQueryProvider>
      <AuthProvider>
        <AppRoutes />
        <Toaster />
      </AuthProvider>
    </ReactQueryProvider>
  );
}

// Data router (for useBlocker: unsaved changes also hold the browser's back button); the app's
// routes stay declarative in AppRoutes. `errorElement`: render errors and failed chunk loads show the
// error page instead of the router default; unknown URLs end at the catch-all route in AppRoutes.
const router = createBrowserRouter([
  { path: "*", element: <Root />, errorElement: <RouteErrorPage /> },
]);

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
