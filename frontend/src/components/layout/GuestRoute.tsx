import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";
import { FullPageLoader } from "@/components/ui/shared";

/** Pages for signed-out visitors (login, signup, forgot password): signed-in users go to /clubs. */
export default function GuestRoute() {
  const { user, loading, sessionError } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/clubs" replace />;
  // A session exists but could not be checked yet: never show the login form to a signed-in user.
  if (sessionError) return <FullPageLoader />;
  return <Outlet />;
}
