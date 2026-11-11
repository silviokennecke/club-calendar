import { describe, expect, it } from "vitest";
import { contextHelpPath } from "../contextHelp";

const CAL = "/clubs/c1/calendars/k1";

describe("contextHelpPath", () => {
  it.each([
    [`/clubs/c1/me`, "", "/help/getting-started/my-club"],
    [`/clubs/c1/me`, "?tab=subscription", "/help/publishing/subscribe"],
    [`/clubs/c1/me/events/e1`, "", "/help/getting-started/my-club"],
    [`/clubs/c1/settings/locations`, "", "/help/organize/locations"],
    [`/clubs/c1/settings/target-groups`, "", "/help/organize/target-groups"],
    [`/clubs/c1/settings/feeds`, "", "/help/publishing/feeds"],
    [`/clubs/c1/settings/feeds/new`, "", "/help/publishing/create-feed"],
    [`/clubs/c1/settings/feeds/f1`, "", "/help/publishing/create-feed"],
    [`/clubs/c1`, "", "/help/settings/club"],
    [`/clubs/c1`, "?tab=calendars", "/help/settings/calendars"],
    [`/clubs/c1`, "?tab=members", "/help/team/members"],
    [CAL, "", "/help/events/views"],
    [`${CAL}/events`, "", "/help/events/event-list"],
    [`${CAL}/events/export`, "", "/help/organize/export"],
    [`${CAL}/events/new/form`, "", "/help/events/first-event"],
    [`${CAL}/events/e1`, "", "/help/events/edit"],
    [`${CAL}/import`, "", "/help/organize/import"],
    [`${CAL}/templates`, "", "/help/organize/templates"],
    [`${CAL}/templates/t1`, "", "/help/organize/templates"],
    [`${CAL}/settings`, "", "/help/settings/calendar-settings"],
    [`${CAL}/settings/properties`, "", "/help/organize/properties"],
    [`${CAL}/settings/features`, "", "/help/organize/features"],
    [`${CAL}/settings/holiday-calendars`, "", "/help/organize/holidays"],
    ["/profile", "", "/help/settings/profile"],
    ["/login", "", "/help/getting-started/sign-up"],
    ["/something-unknown", "", "/help"],
  ])("%s%s -> %s", (path, search, expected) => {
    expect(contextHelpPath(path, search)).toBe(expected);
  });
});
