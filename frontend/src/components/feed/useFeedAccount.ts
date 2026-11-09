import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { apiErrorStatus, apiGet } from "@/lib/api";
import { AuthContext } from "@/lib/auth-context";
import { myClubPath } from "@/lib/club/myClub";
import { useClaimFeed, useFeedMembership, useMyFeeds } from "@/lib/club/memberApi";
import { feedJoinFailure, feedJoinPath, stashFeedProof } from "@/lib/feeds/feedProof";
import type { Club } from "@/lib/types";
import { toast } from "@/components/ui/shared";

export interface FeedAccountAction {
  label: string;
  /** Becomes the main action of the split button (else a menu entry). */
  primary: boolean;
  run: () => void;
}

/**
 * The "add to my account" entry of the public feed page, by state: signed out (sign-in, then the join
 * page), signed in and already added (show it), member without the feed (add directly), not a member (join
 * page). Returns null while unknown or when the feed cannot be added.
 */
export function useFeedAccount(feedId: string, secret: string | undefined) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const ready = !!user && !user.consentRequired && !user.emailVerificationRequired;
  const claim = useClaimFeed();

  const membership = useFeedMembership(feedId, secret, ready);
  const member = membership.data?.isClubMember === true;
  // The membership answer has no club id: a unique club of that name is the one.
  const clubs = useQuery({
    queryKey: ["clubs"],
    queryFn: () => apiGet<Club[]>("/api/clubs"),
    enabled: ready && member,
  });
  const matches = clubs.data?.filter((c) => c.name === membership.data?.clubName) ?? [];
  const clubId = matches.length === 1 ? matches[0].id : undefined;
  const myFeeds = useMyFeeds(member ? clubId : undefined);
  const inAccount = myFeeds.data?.feeds.some((f) => f.id === feedId && f.selected) === true;

  const addLabel = t("feed.account.add");
  const goJoin = () => {
    stashFeedProof({ feedId, secret });
    navigate(feedJoinPath(feedId));
  };

  async function addDirectly() {
    try {
      const result = await claim.mutateAsync({ feedId, secret });
      toast.success(t("feed.account.added"));
      navigate(myClubPath(result.clubId));
    } catch (error) {
      const failure = feedJoinFailure(error);
      if (failure === "failed") toast.error(t("feedJoin.problem.failed"));
      else if (failure !== "quota") toast.error(t(`feedJoin.problem.${failure}`));
    }
  }

  if (!auth) return null;
  if (!user) {
    return {
      label: addLabel,
      primary: false,
      run: () => {
        stashFeedProof({ feedId, secret });
        navigate("/login");
      },
    } satisfies FeedAccountAction;
  }
  if (!ready) return { label: addLabel, primary: true, run: goJoin } satisfies FeedAccountAction;
  if (membership.isPending) return null;
  if (membership.isError) {
    // A feed the server does not know (or a wrong secret) cannot be added; other failures: the join page explains.
    if (apiErrorStatus(membership.error) === 404) return null;
    return { label: addLabel, primary: false, run: goJoin } satisfies FeedAccountAction;
  }
  const info = membership.data;
  if (!info.isClubMember) {
    return info.canJoin
      ? ({ label: addLabel, primary: true, run: goJoin } satisfies FeedAccountAction)
      : null;
  }
  if (!info.hasFeedAccess && !info.canClaim) return null;
  if (clubs.isPending || (clubId && myFeeds.isPending)) return null;
  if (inAccount && clubId) {
    return {
      label: t("feed.account.show"),
      primary: true,
      run: () => navigate(myClubPath(clubId)),
    } satisfies FeedAccountAction;
  }
  return {
    label: addLabel,
    primary: true,
    run: () => void addDirectly(),
  } satisfies FeedAccountAction;
}
