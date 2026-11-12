import { DangerSection } from "@/components/profile/DangerSection";
import { LegalSection } from "@/components/profile/LegalSection";
import { useScrollToHash } from "@/lib/profile/useScrollToHash";

export default function ProfilePrivacyTab() {
  useScrollToHash();
  return (
    <div className="ap-stack ap-stack--lg">
      <LegalSection />
      <DangerSection />
    </div>
  );
}
