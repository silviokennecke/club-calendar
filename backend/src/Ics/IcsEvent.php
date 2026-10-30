<?php

declare(strict_types=1);

namespace App\Ics;

/** Exactly the data of one event the ICS output uses (no entity, no lazy associations). */
final readonly class IcsEvent
{
    /**
     * @param string       $date             Y-m-d
     * @param string|null  $dateEnd          Y-m-d
     * @param list<string> $propertyIcons    non-empty icons, in assignment order
     * @param list<string> $propertyNames    names of the properties behind $propertyIcons (same order and length)
     * @param list<string> $featureNames
     * @param list<string> $targetGroupNames
     */
    public function __construct(
        public string $id,
        public string $name,
        public ?string $timezone,
        public ?string $calendarTimezone,
        public string $date,
        public ?string $dateEnd,
        public string $timeBegin,
        public string $timeEnd,
        public bool $isAllDay,
        public bool $isDraft,
        public ?string $note,
        public ?IcsLocation $location,
        public array $propertyIcons,
        public array $propertyNames,
        public array $featureNames,
        public array $targetGroupNames,
    ) {
    }
}
