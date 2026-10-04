import { createBrowserRouter, Navigate, Outlet, Route, RouterProvider } from "react-router-dom";
import { ReactQueryProvider } from "./lib/react-query-provider";
import { useAuth } from "./lib/auth-context";
import { AuthProvider } from "./lib/AuthProvider";
import { ThemeProvider } from "./lib/ThemeProvider";
import { ModalFrame, Toaster } from "./components/ui/shared";
import ProtectedRoute from "./components/layout/ProtectedRoute";
import GuestRoute from "./components/layout/GuestRoute";
import { BackgroundRoutes } from "./components/layout/BackgroundRoutes";

import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import EmailVerifyPage from "./pages/EmailVerifyPage";
import FeedPage from "./pages/FeedPage";
import PublicEventModal from "./pages/PublicEventModal";
import ClubsPage from "./pages/ClubsPage";
import SetupPage from "./pages/SetupPage";
import ProfilePage from "./pages/ProfilePage";
import ClubPage from "./pages/ClubPage";
import CalendarPage from "./pages/CalendarPage";
import EventsListPage from "./pages/events/EventsListPage";
import EventNewModal from "./pages/events/EventNewModal";
import EventFormModal from "./pages/events/EventFormModal";
import EventTemplatePickModal from "./pages/events/EventTemplatePickModal";
import EventFromTemplateModal from "./pages/events/EventFromTemplateModal";
import EventsExportPage from "./pages/events/EventsExportPage";
import ImportPage from "./pages/ImportPage";
import TemplatesPage from "./pages/TemplatesPage";
import TemplateEditPage from "./pages/TemplateEditPage";
import MorePage from "./pages/MorePage";
import CalendarSettingsPage from "./pages/settings/CalendarSettingsPage";
import FeedsPage from "./pages/settings/FeedsPage";
import FeedEditPage from "./pages/settings/FeedEditPage";
import PropertiesPage from "./pages/settings/PropertiesPage";
import FeaturesPage from "./pages/settings/FeaturesPage";
import LocationsPage from "./pages/settings/LocationsPage";
import TargetGroupsPage from "./pages/settings/TargetGroupsPage";
import HolidayCalendarsPage from "./pages/settings/HolidayCalendarsPage";

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
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/verify-email" element={<EmailVerifyPage />} />
          <Route path="/feed/:feedId" element={<FeedPage />} />

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
              path="/clubs/:clubId/calendars/:calendarId/settings/feeds"
              element={<FeedsPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/feeds/new"
              element={<FeedEditPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/feeds/:feedId"
              element={<FeedEditPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/properties"
              element={<PropertiesPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/features"
              element={<FeaturesPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/locations"
              element={<LocationsPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/target-groups"
              element={<TargetGroupsPage />}
            />
            <Route
              path="/clubs/:clubId/calendars/:calendarId/settings/holiday-calendars"
              element={<HolidayCalendarsPage />}
            />
          </Route>
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
            </Route>
          </Route>
          <Route element={<ModalFrame />}>
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
  return !loading && user ? <Outlet /> : null;
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
// routes stay declarative in AppRoutes.
const router = createBrowserRouter([{ path: "*", element: <Root /> }]);

export default function App() {
  return (
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
