import { useRegistrationInfo } from "@/lib/registration";

/** Product name, the default instance name and the "powered by" name. */
export const PROJECT_NAME = "Club Calendar";

/** Instance name from the backend; the default name while loading or on failure. */
export function useAppName(): string {
  const { data } = useRegistrationInfo();
  return data?.appName?.trim() || PROJECT_NAME;
}
