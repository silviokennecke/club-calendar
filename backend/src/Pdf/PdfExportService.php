<?php

declare(strict_types=1);

namespace App\Pdf;

use App\Entity\Calendar;
use App\Entity\EventProperty;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Ics\IcsEvent;
use App\Ics\IcsEventReader;
use App\Service\EventExportService;
use App\Service\EventImportService;
use App\Service\ExportFilter;
use App\Service\Input;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autoconfigure;
use Twig\Environment;

/**
 * PDF export of a calendar's events: the shared export query, per-day arrays in the club time zone, a Twig
 * template per layout and a hardened dompdf. Event text only reaches the engine through Twig auto-escape.
 */
#[Autoconfigure(public: true)]
class PdfExportService
{
    public const int MAX_RANGE_DAYS = 366;
    public const int MAX_EVENTS = 2000;

    private const int LEGEND_BATCH = 500;
    private const int MAX_NAME = 200;
    private const int MAX_LOCATION = 120;
    private const int MAX_TAG = 60;

    public function __construct(
        private readonly EventExportService $export,
        private readonly IcsEventReader $reader,
        private readonly EmojiImages $emoji,
        private readonly EntityManagerInterface $em,
        private readonly Environment $twig,
        private readonly DompdfFactory $dompdf,
        private readonly int $maxEvents = self::MAX_EVENTS,
    ) {
    }

    /** The PDF document (binary). */
    public function render(Calendar $calendar, ExportFilter $filter, PdfOptions $options, User $user): string
    {
        $html = $this->renderHtml($calendar, $filter, $options, $user);

        $pdf = $this->dompdf->create();
        $pdf->setPaper($options->paper, $options->resolvedOrientation());
        $pdf->loadHtml($html, 'UTF-8');
        $pdf->render();

        return (string) $pdf->output();
    }

    public function renderHtml(Calendar $calendar, ExportFilter $filter, PdfOptions $options, User $user): string
    {
        return $this->twig->render($options->layout->template(), $this->buildViewModel($calendar, $filter, $options, $user));
    }

    /**
     * @return array<string, mixed>
     */
    public function buildViewModel(Calendar $calendar, ExportFilter $filter, PdfOptions $options, User $user): array
    {
        $from = $filter->fromDate ?? throw Input::invalid('from', 'from is required for the PDF export');
        $to = $filter->toDate ?? throw Input::invalid('to', 'to is required for the PDF export');
        if (!$options->layout->available($from, $to)) {
            throw Input::invalid('layout', 'This layout is not available for the selected period');
        }
        Input::assertMaxRange($from, $to, self::MAX_RANGE_DAYS);

        $qb = $this->export->buildQuery($calendar, $filter);
        $count = (int) (clone $qb)->select('COUNT(e.id)')->getQuery()->getSingleScalarResult();
        if ($count > $this->maxEvents) {
            throw new ApiProblemException(422, sprintf('A PDF contains at most %d events', $this->maxEvents), EventImportService::TOO_MANY_CODE, 'to');
        }

        $locale = 'de' === $user->getLanguage() ? 'de' : 'en';
        $firstDayOfWeek = 0 === $user->getFirstDayOfWeek() ? 0 : 1;
        $zone = new \DateTimeZone(Input::canonicalTimezone($calendar->getClub()->getTimezone()) ?? 'UTC');

        $entries = [];
        $iconEventIds = [];
        foreach ($this->reader->chunks($qb, $this->maxEvents) as $chunk) {
            foreach ($chunk as $event) {
                $paths = $this->emojiPaths($event->propertyIcons);
                if ([] !== $event->propertyIcons) {
                    $iconEventIds[] = $event->id;
                }
                foreach ($this->entriesOf($event, $zone, $from, $to, $paths) as $entry) {
                    $entries[] = $entry;
                }
            }
        }
        usort($entries, static fn (array $a, array $b): int => [$a['sortDate'], $a['sortTime'], $a['id']] <=> [$b['sortDate'], $b['sortTime'], $b['id']]);

        $model = [
            'locale' => $locale,
            'firstDayOfWeek' => $firstDayOfWeek,
            'calendarName' => PdfText::truncate(PdfText::stripEmoji($calendar->getName()), self::MAX_NAME),
            'clubName' => PdfText::truncate(PdfText::stripEmoji($calendar->getClub()->getName()), self::MAX_NAME),
            'includeDrafts' => $filter->drafts,
            'from' => PdfDates::formatDate($from, $locale),
            'to' => PdfDates::formatDate($to, $locale),
            'generatedAt' => PdfDates::formatDate(new \DateTimeImmutable('now', $zone), $locale),
            'pageSize' => strtoupper($options->paper).' '.$options->resolvedOrientation(),
            // the quarter layout prints a legend per page instead
            'legend' => PdfLayout::QuarterOverview === $options->layout ? [] : $this->legend($iconEventIds, $locale),
        ];

        return $model + match ($options->layout) {
            PdfLayout::Agenda => ['rows' => $this->agendaRows($entries, $locale)],
            PdfLayout::MonthGrid => [
                'months' => PdfMonthGrid::build($from, $to, $firstDayOfWeek, $entries, $locale),
                'weekdays' => PdfMonthGrid::weekdayHeader($firstDayOfWeek, $locale),
            ],
            PdfLayout::QuarterOverview => ['pages' => $this->quarterPages($from, $to, $entries, $locale, $options)],
            PdfLayout::AnnualOverview => [
                'year' => (int) $from->format('Y'),
                'months' => PdfAnnualOverview::build((int) $from->format('Y'), $firstDayOfWeek, $entries, $locale),
                'weekdays' => PdfMonthGrid::weekdayHeader($firstDayOfWeek, $locale),
                'events' => PdfAnnualOverview::eventList($entries, $locale),
            ],
            default => throw new \LogicException(sprintf('Layout "%s" is not implemented yet.', $options->layout->value)),
        };
    }

    /**
     * @param list<string> $icons
     *
     * @return list<string> chroot-relative absolute paths of the resolvable icons, without duplicates
     */
    private function emojiPaths(array $icons): array
    {
        $paths = [];
        foreach ($icons as $icon) {
            $path = $this->emoji->resolve($icon);
            if (null !== $path) {
                $paths[$path] = $path;
            }
        }

        return array_values($paths);
    }

    /**
     * One entry per day of the event inside from..to, in the club time zone.
     *
     * @param list<string> $emojiPaths
     *
     * @return list<array<string, mixed>>
     */
    private function entriesOf(IcsEvent $event, \DateTimeZone $clubZone, \DateTimeImmutable $from, \DateTimeImmutable $to, array $emojiPaths): array
    {
        $startDate = $event->date;
        $endDate = $event->dateEnd ?? $event->date;
        $beginTime = null;
        $endTime = null;

        if (!$event->isAllDay) {
            try {
                $tz = new \DateTimeZone(Input::canonicalTimezone($event->timezone) ?? Input::canonicalTimezone($event->calendarTimezone) ?? $clubZone->getName());
                $start = (new \DateTimeImmutable("$event->date $event->timeBegin", $tz))->setTimezone($clubZone);
                $end = (new \DateTimeImmutable(($event->dateEnd ?? $event->date).' '.$event->timeEnd, $tz))->setTimezone($clubZone);
                if ($end < $start) {
                    $end = $start;
                }
                $startDate = $start->format('Y-m-d');
                $endDate = $end->format('Y-m-d');
                $beginTime = $start->format('H:i');
                $endTime = $end->format('H:i');
            } catch (\Exception) {
                // a stored invalid time is shown as all-day, like the ICS output
            }
        }

        $location = $event->location;
        $locationText = '';
        if (null !== $location) {
            $parts = array_filter([$location->name, $location->street, trim(($location->zip ?? '').' '.($location->city ?? ''))], static fn (?string $p): bool => null !== $p && '' !== $p);
            $locationText = PdfText::truncate(PdfText::stripEmoji(implode(', ', $parts)), self::MAX_LOCATION);
        }
        $tags = array_map(
            static fn (string $name): string => PdfText::truncate(PdfText::stripEmoji($name), self::MAX_TAG),
            array_merge($event->featureNames, $event->targetGroupNames),
        );
        $features = array_map(
            static fn (string $name): string => PdfText::truncate(PdfText::stripEmoji($name), self::MAX_TAG),
            $event->featureNames,
        );

        $entries = [];
        $day = new \DateTimeImmutable($startDate, $clubZone);
        $last = new \DateTimeImmutable($endDate, $clubZone);
        $first = true;
        for (; $day <= $last; $day = $day->modify('+1 day')) {
            $ymd = $day->format('Y-m-d');
            if ($ymd < $from->format('Y-m-d') || $ymd > $to->format('Y-m-d')) {
                $first = false;
                continue;
            }
            $entries[] = [
                'id' => $event->id,
                'sortDate' => $ymd,
                'sortTime' => $first ? ($beginTime ?? '') : '',
                'day' => $day,
                'allDay' => null === $beginTime,
                'continued' => !$first,
                'begin' => $first ? $beginTime : null,
                'end' => $ymd === $endDate && $ymd !== $startDate ? $endTime : ($first && $startDate === $endDate ? $endTime : null),
                'name' => PdfText::truncate(PdfText::stripEmoji($event->name), self::MAX_NAME),
                'location' => $locationText,
                'tags' => $tags,
                'features' => $features,
                'emojiPaths' => $emojiPaths,
                'draft' => $event->isDraft,
            ];
            $first = false;
        }

        return $entries;
    }

    /**
     * @param list<array<string, mixed>> $entries
     *
     * @return list<array<string, mixed>> pages with their own legend of the properties used on that page
     */
    private function quarterPages(\DateTimeImmutable $from, \DateTimeImmutable $to, array $entries, string $locale, PdfOptions $options): array
    {
        $pages = PdfQuarterOverview::build($from, $to, $entries, $locale, $options->contentHeightPt(), $options->contentWidthPt());
        foreach ($pages as &$page) {
            $page['legend'] = $this->legend($page['eventIds'], $locale);
        }

        return $pages;
    }

    /**
     * @param list<array<string, mixed>> $entries
     *
     * @return list<array{label: string, entries: list<array<string, mixed>>}> entries grouped by month
     */
    private function agendaRows(array $entries, string $locale): array
    {
        $groups = [];
        foreach ($entries as $entry) {
            /** @var \DateTimeImmutable $day */
            $day = $entry['day'];
            $key = $day->format('Y-m');
            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'label' => PdfDates::monthName((int) $day->format('Y'), (int) $day->format('n'), $locale).' '.$day->format('Y'),
                    'entries' => [],
                ];
            }
            $entry['dateLabel'] = PdfDates::weekdayShort((int) $day->format('w'), $locale).', '.PdfDates::formatDate($day, $locale);
            $groups[$key]['entries'][] = $entry;
        }

        return array_values($groups);
    }

    /**
     * Emoji legend of the properties used by the exported events; only icons with a bundled image appear.
     *
     * @param list<string> $eventIds
     *
     * @return list<array{emojiPath: string, names: list<string>}>
     */
    private function legend(array $eventIds, string $locale): array
    {
        $byPath = [];
        foreach (array_chunk($eventIds, self::LEGEND_BATCH) as $ids) {
            $rows = $this->em->createQueryBuilder()
                ->select('DISTINCT p.icon AS icon', 'p.name AS name')
                ->from(EventProperty::class, 'ep')
                ->join('ep.property', 'p')
                ->where('ep.event IN (:ids)')
                ->andWhere('p.icon IS NOT NULL')
                ->setParameter('ids', $ids)
                ->getQuery()
                ->getArrayResult();
            foreach ($rows as $row) {
                $path = $this->emoji->resolve((string) $row['icon']);
                if (null === $path) {
                    continue;
                }
                $name = PdfText::truncate(PdfText::stripEmoji((string) $row['name']), self::MAX_TAG);
                if ('' !== $name) {
                    $byPath[$path][$name] = $name;
                }
            }
        }

        $collator = new \Collator($locale);
        $legend = [];
        foreach ($byPath as $path => $names) {
            $names = array_values($names);
            usort($names, static fn (string $a, string $b): int => $collator->compare($a, $b));
            $legend[] = ['emojiPath' => $path, 'names' => $names];
        }
        usort($legend, static fn (array $a, array $b): int => $collator->compare($a['names'][0], $b['names'][0]));

        return $legend;
    }
}
