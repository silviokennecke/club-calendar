import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ReactQueryProvider } from "./lib/react-query-provider";
import { AuthProvider } from "./lib/auth-context";
import { ThemeProvider } from "./lib/ThemeProvider";
import { Toaster } from "./components/ui/shared";
import ProtectedRoute from "./components/layout/ProtectedRoute";

import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import AuthCallbackPage from "./pages/AuthCallbackPage";
import EmailVerifyPage from "./pages/EmailVerifyPage";
import FeedPage from "./pages/FeedPage";
import ClubsPage from "./pages/ClubsPage";
import SetupPage from "./pages/SetupPage";
import ProfilePage from "./pages/ProfilePage";
import ClubPage from "./pages/ClubPage";
import CalendarPage from "./pages/CalendarPage";
import EventsListPage from "./pages/EventsListPage";
import ImportPage from "./pages/ImportPage";
import TemplatesPage from "./pages/TemplatesPage";
import MorePage from "./pages/MorePage";
import CalendarSettingsPage from "./pages/settings/CalendarSettingsPage";
import FeedsPage from "./pages/settings/FeedsPage";
import PropertiesPage from "./pages/settings/PropertiesPage";
import FeaturesPage from "./pages/settings/FeaturesPage";
import LocationsPage from "./pages/settings/LocationsPage";
import TargetGroupsPage from "./pages/settings/TargetGroupsPage";
import HolidayCalendarsPage from "./pages/settings/HolidayCalendarsPage";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ReactQueryProvider>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
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
                  path="/clubs/:clubId/calendars/:calendarId/import"
                  element={<ImportPage />}
                />
                <Route
                  path="/clubs/:clubId/calendars/:calendarId/templates"
                  element={<TemplatesPage />}
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
            </Routes>
            <Toaster />
          </AuthProvider>
        </ReactQueryProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
