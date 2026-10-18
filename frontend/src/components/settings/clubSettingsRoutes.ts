/** URLs of the club settings pages (locations, target groups, feeds; all routes are defined in src/App.tsx). */
export function clubSettingsRoutes(clubId: string) {
  const base = `/clubs/${clubId}/settings`;
  return {
    base,
    club: `/clubs/${clubId}`,
    locations: `${base}/locations`,
    targetGroups: `${base}/target-groups`,
    feeds: `${base}/feeds`,
    /** New feed (design: FeedEdit, mode new). */
    feedNew: `${base}/feeds/new`,
    /** Edit a feed (design: FeedEdit). */
    feed: (feedId: string) => `${base}/feeds/${feedId}`,
  };
}
