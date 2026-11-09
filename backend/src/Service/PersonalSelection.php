<?php

declare(strict_types=1);

namespace App\Service;

/**
 * The effective feeds of a personal subscription at one moment (selected AND accessible AND with an active
 * calendar), read without entities. `feeds` hold ids, config and sorted calendar/target group ids; `versions` maps
 * the active calendars of those feeds to their content versions.
 */
final readonly class PersonalSelection
{
    /**
     * @param list<array{id: string, name: string, visibility: string, secret: string, updatedAt: string, groups: list<string>, calendars: list<string>}> $feeds
     * @param list<string>                                                                                                                                $targetGroupIds subscription selection (empty = all)
     * @param array<string, string>                                                                                                                       $versions       calendar id => content version
     */
    public function __construct(
        public ?string $subscriptionId,
        public string $clubId,
        public string $clubName,
        public string $timezone,
        public array $feeds,
        public array $targetGroupIds,
        public array $versions,
    ) {
    }

    /** @return list<string> */
    public function calendarIds(): array
    {
        return array_keys($this->versions);
    }

    /**
     * The target group filter one feed really applies for a requested set: the feed's own groups cut with the
     * request (a feed limited to some groups never shows others). null = no filter, [] = nothing may be shown.
     *
     * @param list<string>      $feedGroups
     * @param list<string>|null $requested
     *
     * @return list<string>|null
     */
    public function effectiveGroups(array $feedGroups, ?array $requested): ?array
    {
        if ([] === $feedGroups) {
            return $requested;
        }
        if (null === $requested) {
            return $feedGroups;
        }
        $effective = array_values(array_intersect($requested, $feedGroups));
        sort($effective, SORT_STRING);

        return $effective;
    }

    /**
     * Feeds with the same filter merged: one entry per distinct filter with the union of their calendars. Feeds
     * that may show nothing are dropped; an empty result means no event at all.
     *
     * @param list<string>|null $requested
     *
     * @return list<array{0: list<string>, 1: list<string>|null}> calendar ids and group filter
     */
    public function branches(?array $requested): array
    {
        $byFilter = [];
        foreach ($this->feeds as $feed) {
            $groups = $this->effectiveGroups($feed['groups'], $requested);
            if ([] === $groups) {
                continue;
            }
            $key = json_encode($groups, JSON_THROW_ON_ERROR);
            $byFilter[$key] ??= [[], $groups];
            $byFilter[$key][0] = array_values(array_unique([...$byFilter[$key][0], ...$feed['calendars']]));
        }

        return array_values($byFilter);
    }
}
