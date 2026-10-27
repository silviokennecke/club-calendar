import { Navigate, useLocation } from "react-router-dom";
import { helpPath } from "@/docs/paths";

/** Old guide URL `/help/subscribe[?app=…]`: keeps the query string. */
export function SubscribeRedirect() {
  const { search } = useLocation();
  return <Navigate to={`${helpPath("publishing/subscribe")}${search}`} replace />;
}
