import { useOutletContext } from "react-router-dom";
import type { ProfileData } from "./profileTypes";

export interface ProfileOutletContext {
  /** Undefined while loading or when loading failed (the layout shows that state). */
  profile: ProfileData | undefined;
}

export function useProfileContext(): ProfileOutletContext {
  return useOutletContext<ProfileOutletContext>();
}
