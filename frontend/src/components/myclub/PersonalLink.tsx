import { useTranslation } from "react-i18next";
import { CopyField } from "@/components/ui/shared";
import { mySubscriptionAddresses } from "@/lib/club/memberApi";
import type { MemberSubscription } from "@/lib/types";

/** The personal subscription address as a read-only copy field. */
export function PersonalLink({
  subscription,
  id,
}: {
  subscription: Pick<MemberSubscription, "id" | "secret">;
  id: string;
}) {
  const { t } = useTranslation();
  return (
    <CopyField
      id={id}
      label={t("myClub.link.label")}
      value={mySubscriptionAddresses(subscription).ics}
      hint={t("myClub.link.hint")}
    />
  );
}
