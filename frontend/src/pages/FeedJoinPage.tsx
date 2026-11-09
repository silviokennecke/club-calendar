import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiErrorStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { myClubPath } from "@/lib/club/myClub";
import { useClaimFeed, useFeedMembership } from "@/lib/club/memberApi";
import {
  clearFeedProof,
  feedJoinFailure,
  feedJoinPath,
  readFeedProof,
  stashFeedProof,
  type FeedJoinFailure,
} from "@/lib/feeds/feedProof";
import { Banner, Button, FullPageLoader, LinkButton, toast } from "@/components/ui/shared";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { usePublicFeed } from "@/components/feed/usePublicFeed";

type Dead = "notFound" | "signupDisabled";

/**
 * /feed/:feedId/join : a visitor of a public feed page adds the feed to their account and, if they are not a
 * member yet, becomes a member of the club. Explicit confirmation, like an invitation. The secret of a private
 * feed (`?secret=`) moves into the sessionStorage stash at once and out of the address bar; a visitor who is
 * not signed in goes to the login with it and returns through the club picker.
 */
export default function FeedJoinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { feedId = "" } = useParams<{ feedId: string }>();
  const [params] = useSearchParams();
  const { user, loading, updateUser } = useAuth();
  const urlSecret = params.get("secret") || undefined;
  const [secret] = useState<string | undefined>(() => {
    if (urlSecret) return urlSecret;
    const stash = readFeedProof();
    return stash?.feedId === feedId ? stash.secret : undefined;
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FeedJoinFailure | null>(null);
  const claim = useClaimFeed();

  useEffect(() => {
    if (!urlSecret) return;
    stashFeedProof({ feedId, secret: urlSecret });
    navigate(feedJoinPath(feedId), { replace: true });
  }, [urlSecret, feedId, navigate]);

  const ready = !!user && !user.consentRequired && !user.emailVerificationRequired;
  useEffect(() => {
    if (loading || urlSecret) return;
    if (!user) {
      stashFeedProof({ feedId, secret });
      navigate("/login", { replace: true });
    } else if (user.emailVerificationRequired) {
      stashFeedProof({ feedId, secret });
      navigate("/verify-email", { replace: true });
    } else if (user.consentRequired) {
      // the consent gate comes first; the stash survives and the club picker forwards back here
      stashFeedProof({ feedId, secret });
      navigate("/clubs", { replace: true });
    }
  }, [loading, user, urlSecret, feedId, secret, navigate]);

  const membership = useFeedMembership(feedId, secret, ready && !urlSecret);
  // Name of the feed for the text; a single day keeps the answer small. Failures just leave the name out.
  const today = new Date().toISOString().slice(0, 10);
  const feed = usePublicFeed(ready ? feedId : undefined, secret, { from: today, to: today });

  const backToFeed = () => {
    clearFeedProof();
    navigate(feedBackPath(feedId, secret), { replace: true });
  };

  if (loading || !ready || urlSecret || (membership.isPending && !membership.isError))
    return <FullPageLoader message={t("common.loading")} />;

  const info = membership.data;
  let dead: Dead | null = null;
  if (membership.isError && apiErrorStatus(membership.error) === 404) dead = "notFound";
  else if (info && !info.isClubMember && !info.canJoin) dead = "signupDisabled";
  else if (info && info.isClubMember && !info.hasFeedAccess && !info.canClaim) dead = "notFound";
  if (!dead && (failure === "notFound" || failure === "signupDisabled")) dead = failure;

  async function confirm() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await claim.mutateAsync({ feedId, secret });
      clearFeedProof();
      toast.success(
        t(result.joined ? "feedJoin.joined" : "feedJoin.added", { club: result.clubName }),
      );
      void updateUser({ lastClubId: result.clubId, lastCalendarId: null });
      navigate(myClubPath(result.clubId), { replace: true });
    } catch (error) {
      setFailure(feedJoinFailure(error));
    } finally {
      setBusy(false);
    }
  }

  if (dead || (membership.isError && !info)) {
    const key = dead ?? "failed";
    return (
      <AuthLayout icon="user-plus" title={t("feedJoin.title")}>
        <div className="ap-stack">
          <Banner tone="danger" title={t("feedJoin.errorTitle")}>
            {t(`feedJoin.problem.${key}`)}
          </Banner>
          {dead ? (
            <LinkButton to={feedBackPath(feedId, secret)} block onClick={clearFeedProof}>
              {t("feedJoin.backToFeed")}
            </LinkButton>
          ) : (
            <Button block variant="secondary" onClick={() => void membership.refetch()}>
              {t("feedJoin.retry")}
            </Button>
          )}
        </div>
      </AuthLayout>
    );
  }

  const club = info?.clubName ?? "";
  const feedName = feed.data?.feed.name;
  const member = info?.isClubMember === true;

  return (
    <AuthLayout
      icon="user-plus"
      title={t(member ? "feedJoin.addTitle" : "feedJoin.title")}
      intro={t(member ? "feedJoin.addIntro" : "feedJoin.intro", { club })}
    >
      <div className="ap-stack">
        <p className="t-body">
          {feedName
            ? t("feedJoin.feedNamed", { name: feedName, club })
            : t("feedJoin.feedUnnamed", { club })}
        </p>
        {failure && failure !== "notFound" && failure !== "signupDisabled" && (
          <Banner tone="danger" title={t("feedJoin.errorTitle")}>
            {t(`feedJoin.problem.${failure}`)}
          </Banner>
        )}
        <Button block icon="check" loading={busy} disabled={busy} onClick={() => void confirm()}>
          {t(member ? "feedJoin.confirmAdd" : "feedJoin.confirm")}
        </Button>
        <Button block variant="secondary" disabled={busy} onClick={backToFeed}>
          {t("common.cancel")}
        </Button>
      </div>
    </AuthLayout>
  );
}

function feedBackPath(feedId: string, secret: string | undefined): string {
  return `/feed/${encodeURIComponent(feedId)}${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
}
