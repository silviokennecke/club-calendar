<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use App\Enum\HolidaySource;
use App\Enum\HolidayType;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Cache\CacheItemPoolInterface;
use Psr\Clock\ClockInterface;
use Psr\Log\LoggerInterface;
use Sabre\VObject;
use Symfony\Contracts\HttpClient\Exception\ClientExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\RedirectionExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\ServerExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

readonly class HolidayCalendarService
{
    /** Largest ICS body accepted from a holiday URL (bytes) and most events stored per fetch (M7). */
    public const MAX_BYTES = 1_048_576;
    public const MAX_EVENTS = 5000;
    public const MAX_REDIRECTS = 3;

    public function __construct(
        private HttpClientInterface $httpClient,
        private EntityManagerInterface $em,
        private CalendarVersionBumper $versionBumper,
        private OpenHolidaysClient $openHolidays,
        private ClockInterface $clock,
        private CacheItemPoolInterface $refreshAttemptsCache,
        private LoggerInterface $logger,
    ) {
    }

    /** Predefined calendars are re-fetched when the last fetch is older than this. */
    public const STALE_AFTER = '-3 months';

    /**
     * Creates one OpenHolidays calendar per kind (public|school) and imports its events (one API request each).
     * Throws before anything is stored when a request fails.
     *
     * @param list<string> $kinds
     *
     * @return list<array{calendar: HolidayCalendar, eventCount: int}>
     */
    public function createPredefined(Calendar $calendar, string $country, ?string $subdivision, array $kinds, string $language, string $regionName): array
    {
        $country = strtoupper($country);
        $label = ['public' => 'de' === $language ? 'Feiertage' : 'Public holidays', 'school' => 'de' === $language ? 'Schulferien' : 'School holidays'];
        $built = [];
        foreach ($kinds as $kind) {
            $hc = new HolidayCalendar($calendar, sprintf('%s – %s', $regionName, $label[$kind]), null);
            $hc->setType('school' === $kind ? HolidayType::SCHOOL : HolidayType::PUBLIC);
            $hc->useOpenHolidays($country, $subdivision, $language);
            $built[] = ['calendar' => $hc, 'rows' => $this->fetchOpenHolidaysRows($hc)];
        }
        $created = [];
        $this->em->wrapInTransaction(function () use ($built, &$created): void {
            foreach ($built as $item) {
                $this->em->persist($item['calendar']);
                $this->em->flush();
                $created[] = ['calendar' => $item['calendar'], 'eventCount' => $this->storeRows($item['calendar'], $item['rows'])];
            }
        });

        return $created;
    }

    /**
     * Re-fetches a stale OpenHolidays calendar. Never throws; a failed attempt is logged and not retried for an hour.
     */
    public function refreshIfStale(HolidayCalendar $hc): void
    {
        if (HolidaySource::OPENHOLIDAYS !== $hc->getSource()) {
            return;
        }
        $last = $hc->getLastFetchedAt();
        if (null !== $last && $last > $this->clock->now()->modify(self::STALE_AFTER)) {
            return;
        }
        $attempt = $this->refreshAttemptsCache->getItem('refresh_'.str_replace('-', '', $hc->getId()));
        if ($attempt->isHit()) {
            return;
        }
        $attempt->set(true);
        $this->refreshAttemptsCache->save($attempt);

        try {
            $this->fetchAndStore($hc);
        } catch (\Throwable $e) {
            $this->logger->warning('Holiday calendar refresh failed', ['holidayCalendar' => $hc->getId(), 'exception' => $e]);
        }
    }

    /**
     * Validates the given URL against SSRF attack vectors.
     * Rejects non-http/https schemes and private/loopback IP ranges.
     *
     * @throws \InvalidArgumentException if the URL is unsafe
     */
    private function assertSafeUrl(string $url): void
    {
        $parsed = parse_url($url);
        if (!isset($parsed['scheme']) || !in_array($parsed['scheme'], ['http', 'https'], true)) {
            throw new \InvalidArgumentException('Only http/https URLs are allowed');
        }
        $host = $parsed['host'] ?? '';
        $ip = filter_var($host, FILTER_VALIDATE_IP);
        if (false !== $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                throw new \InvalidArgumentException('Requests to private/reserved IP ranges are not allowed');
            }
        }
        // Hostname resolution check — guard against DNS rebinding to private IPs
        $resolved = gethostbyname($host);
        if ($resolved !== $host) { // resolved to an IP
            if (!filter_var($resolved, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                throw new \InvalidArgumentException('Resolved host points to a private/reserved IP address');
            }
        }
    }

    /**
     * Fetches the feed of a new (not yet persisted) calendar, then persists it with its holidays in one short
     * transaction. Nothing is stored when the fetch fails. Returns the number of holidays stored.
     */
    public function createAndStore(HolidayCalendar $holidayCalendar): int
    {
        $rows = $this->fetchRows($holidayCalendar);

        return $this->em->wrapInTransaction(function () use ($holidayCalendar, $rows): int {
            $this->em->persist($holidayCalendar);
            $this->em->flush();

            return $this->storeRows($holidayCalendar, $rows);
        });
    }

    /**
     * Fetches the feed for the given HolidayCalendar (no DB access, no transaction open), then replaces all stored
     * events and updates lastFetchedAt in one short transaction. A failed fetch leaves the stored events untouched.
     * Returns the number of events stored.
     *
     * @throws \InvalidArgumentException     if the URL fails SSRF safety checks
     * @throws TransportExceptionInterface   if the HTTP request fails at the transport level
     * @throws ClientExceptionInterface      if the server returns a 4xx response
     * @throws RedirectionExceptionInterface if the server returns a 3xx response that cannot be followed
     * @throws ServerExceptionInterface      if the server returns a 5xx response
     * @throws \RuntimeException             if the ICS feed exceeds the maximum allowed size
     * @throws \DateMalformedStringException if a DTSTART/DTEND value cannot be parsed
     */
    public function fetchAndStore(HolidayCalendar $holidayCalendar): int
    {
        $rows = $this->fetchRows($holidayCalendar);

        return $this->em->wrapInTransaction(fn (): int => $this->storeRows($holidayCalendar, $rows));
    }

    /** @return list<array{id: string, name: string, date: \DateTimeImmutable, end: ?\DateTimeImmutable}> */
    private function fetchRows(HolidayCalendar $holidayCalendar): array
    {
        if (HolidaySource::OPENHOLIDAYS === $holidayCalendar->getSource()) {
            return $this->fetchOpenHolidaysRows($holidayCalendar);
        }
        $url = $holidayCalendar->getUrl();
        if (null === $url || '' === $url) {
            throw new \InvalidArgumentException('Holiday calendar has no URL');
        }
        $this->assertSafeUrl($url);

        $response = $this->httpClient->request('GET', $url, [
            'max_duration' => 10,
            // Every redirect target is re-checked by NoPrivateNetworkHttpClient (services.yaml)
            'max_redirects' => self::MAX_REDIRECTS,
            // Abort the download as soon as more than MAX_BYTES arrived (also without a Content-Length)
            'on_progress' => static function (int $downloaded): void {
                if ($downloaded > self::MAX_BYTES) {
                    throw new \RuntimeException('ICS feed exceeds maximum allowed size (1 MB)');
                }
            },
        ]);
        $icsContent = $response->getContent(); // throws on 4xx/5xx
        if (strlen($icsContent) > self::MAX_BYTES) {
            throw new \RuntimeException('ICS feed exceeds maximum allowed size (1 MB)');
        }

        $vcalendar = VObject\Reader::read($icsContent);

        $rows = [];
        /** @var VObject\Component\VEvent $vevent */
        foreach ($vcalendar->VEVENT ?? [] as $vevent) {
            $uid = null !== $vevent->UID ? (string) $vevent->UID : '';
            if ('' === $uid) {
                // Skip events with no UID — we cannot reliably identify or deduplicate them
                continue;
            }

            $summary = (string) $vevent->SUMMARY;
            $date = new \DateTimeImmutable($vevent->DTSTART->getValue());
            $date = $date->setTime(0, 0);

            $dateEnd = null;
            if (null !== $vevent->DTEND) {
                $rawEnd = new \DateTimeImmutable($vevent->DTEND->getValue());
                $rawEnd = $rawEnd->setTime(0, 0);
                // ICS all-day DTEND is exclusive → subtract 1 day for inclusive storage
                $inclusive = $rawEnd->modify('-1 day');
                if ($inclusive > $date) {
                    $dateEnd = $inclusive;
                }
            } elseif (null !== $vevent->DURATION) {
                $end = $date->add($vevent->DURATION->getDateInterval())->modify('-1 day');
                if ($end > $date) {
                    $dateEnd = $end;
                }
            }

            if (count($rows) >= self::MAX_EVENTS) {
                throw new \RuntimeException(sprintf('ICS feed has more than %d events', self::MAX_EVENTS));
            }
            $rows[] = ['id' => $uid, 'name' => $summary, 'date' => $date, 'end' => $dateEnd];
        }

        return $rows;
    }

    /**
     * @param list<array{id: string, name: string, date: \DateTimeImmutable, end: ?\DateTimeImmutable}> $rows
     */
    private function storeRows(HolidayCalendar $hc, array $rows): int
    {
        $this->clearEvents($hc);
        foreach ($rows as $row) {
            $this->em->persist(new HolidayEvent($hc, $row['id'], $row['name'], $row['date'], $row['end']));
        }
        $hc->setLastFetchedAt(HolidaySource::OPENHOLIDAYS === $hc->getSource() ? $this->clock->now() : new \DateTimeImmutable());
        $this->em->persist($hc);
        $this->em->flush();

        return count($rows);
    }

    /** @return list<array{id: string, name: string, date: \DateTimeImmutable, end: ?\DateTimeImmutable}> */
    private function fetchOpenHolidaysRows(HolidayCalendar $hc): array
    {
        $country = $hc->getSourceCountry();
        if (null === $country) {
            throw new \InvalidArgumentException('Holiday calendar has no source country');
        }
        $year = (int) $this->clock->now()->format('Y');
        $rows = $this->openHolidays->holidays(
            HolidayType::SCHOOL === $hc->getType() ? OpenHolidaysClient::KIND_SCHOOL : OpenHolidaysClient::KIND_PUBLIC,
            $country,
            $hc->getSourceSubdivision(),
            new \DateTimeImmutable($year.'-01-01'),
            new \DateTimeImmutable(($year + 2).'-12-31'),
            $hc->getSourceLanguage() ?? 'en',
        );
        if (count($rows) > self::MAX_EVENTS) {
            throw new \RuntimeException(sprintf('Holiday source has more than %d events', self::MAX_EVENTS));
        }

        $out = [];
        foreach ($rows as $row) {
            $date = new \DateTimeImmutable($row['start']);
            $end = new \DateTimeImmutable($row['end']);
            $out[] = ['id' => $row['id'], 'name' => $row['name'], 'date' => $date, 'end' => $end > $date ? $end : null];
        }

        return $out;
    }

    /** Deletes all stored events before re-importing (handles removals at the source). */
    private function clearEvents(HolidayCalendar $hc): void
    {
        $this->em->createQuery('DELETE FROM App\Entity\HolidayEvent he WHERE he.holidayCalendar = :hc')
            ->setParameter('hc', $hc)
            ->execute();
        // The bulk DELETE bypasses the unit of work (and ContentVersionListener).
        $this->versionBumper->bumpCalendars([$hc->getCalendar()->getId()]);
    }
}
