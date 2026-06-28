<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use Doctrine\ORM\EntityManagerInterface;
use Sabre\VObject;
use Symfony\Contracts\HttpClient\Exception\ClientExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\RedirectionExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\ServerExceptionInterface;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

readonly class HolidayCalendarService
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private EntityManagerInterface $em,
    ) {
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
     * Fetches the ICS feed for the given HolidayCalendar, replaces all stored events,
     * updates lastFetchedAt, and returns the number of events stored.
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
        $this->assertSafeUrl($holidayCalendar->getUrl());

        $response = $this->httpClient->request('GET', $holidayCalendar->getUrl(), ['max_duration' => 10]);
        $icsContent = $response->getContent(); // throws on 4xx/5xx
        if (strlen($icsContent) > 1_048_576) {
            throw new \RuntimeException('ICS feed exceeds maximum allowed size (1 MB)');
        }

        $vcalendar = VObject\Reader::read($icsContent);

        // Delete all existing events before re-importing (handles removals from the feed)
        $this->em->createQuery('DELETE FROM App\Entity\HolidayEvent he WHERE he.holidayCalendar = :hc')
            ->setParameter('hc', $holidayCalendar)
            ->execute();

        $count = 0;
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

            $this->em->persist(new HolidayEvent($holidayCalendar, $uid, $summary, $date, $dateEnd));
            ++$count;
        }

        $holidayCalendar->setLastFetchedAt(new \DateTimeImmutable());
        $this->em->persist($holidayCalendar);
        $this->em->flush();

        return $count;
    }
}
