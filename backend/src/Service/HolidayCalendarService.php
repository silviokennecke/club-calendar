<?php
declare(strict_types=1);

namespace App\Service;

use App\Entity\HolidayCalendar;
use App\Entity\HolidayEvent;
use DateMalformedStringException;
use DateTimeImmutable;
use Doctrine\ORM\EntityManagerInterface;
use Sabre\VObject;
use Symfony\Contracts\HttpClient\Exception\TransportExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

readonly class HolidayCalendarService
{
    public function __construct(
        private HttpClientInterface $httpClient,
        private EntityManagerInterface $em,
    ) {}

    /**
     * Fetches the ICS feed for the given HolidayCalendar, replaces all stored events,
     * updates lastFetchedAt, and returns the number of events stored.
     *
     * @throws TransportExceptionInterface if the HTTP request fails
     * @throws DateMalformedStringException if a DTSTART/DTEND value cannot be parsed
     */
    public function fetchAndStore(HolidayCalendar $holidayCalendar): int
    {
        $icsContent = $this->httpClient
            ->request('GET', $holidayCalendar->getUrl())
            ->getContent();

        $vcalendar = VObject\Reader::read($icsContent);

        // Delete all existing events before re-importing (handles removals from the feed)
        $this->em->createQuery('DELETE FROM App\Entity\HolidayEvent he WHERE he.holidayCalendar = :hc')
            ->setParameter('hc', $holidayCalendar)
            ->execute();

        $count = 0;
        /** @var VObject\Component\VEvent $vevent */
        foreach ($vcalendar->VEVENT ?? [] as $vevent) {
            $uid = $vevent->UID !== null ? (string) $vevent->UID : '';
            if ($uid === '') {
                // Skip events with no UID — we cannot reliably identify or deduplicate them
                continue;
            }

            $summary = (string) $vevent->SUMMARY;
            $date    = new DateTimeImmutable($vevent->DTSTART->getValue());
            $date    = $date->setTime(0, 0);

            $dateEnd = null;
            if ($vevent->DTEND !== null) {
                $rawEnd    = new DateTimeImmutable($vevent->DTEND->getValue());
                $rawEnd    = $rawEnd->setTime(0, 0);
                // ICS all-day DTEND is exclusive → subtract 1 day for inclusive storage
                $inclusive = $rawEnd->modify('-1 day');
                if ($inclusive > $date) {
                    $dateEnd = $inclusive;
                }
            } elseif ($vevent->DURATION !== null) {
                $end = $date->add($vevent->DURATION->getDateInterval())->modify('-1 day');
                if ($end > $date) {
                    $dateEnd = $end;
                }
            }

            $this->em->persist(new HolidayEvent($holidayCalendar, $uid, $summary, $date, $dateEnd));
            $count++;
        }

        $holidayCalendar->setLastFetchedAt(new DateTimeImmutable());
        $this->em->persist($holidayCalendar);
        $this->em->flush();

        return $count;
    }
}
