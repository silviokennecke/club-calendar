import { CalendarSubscriptionSection } from "@/components/profile/CalendarSubscriptionSection";
import { ConnectedAppsSection } from "@/components/profile/ConnectedAppsSection";
import { useScrollToHash } from "@/lib/profile/useScrollToHash";

export default function ProfileAppsTab() {
  useScrollToHash();
  return (
    <div className="ap-stack ap-stack--lg">
      <CalendarSubscriptionSection />
      <ConnectedAppsSection />
    </div>
  );
}
