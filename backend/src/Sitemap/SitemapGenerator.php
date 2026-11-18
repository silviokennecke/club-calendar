<?php

declare(strict_types=1);

namespace App\Sitemap;

use App\Enum\FeedVisibility;
use Doctrine\DBAL\ArrayParameterType;
use Doctrine\DBAL\Connection;
use League\Flysystem\FilesystemOperator;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Sitemaps of the PUBLIC feeds (the only indexable pages): feed pages and their published events, written to
 * app.storage under `sitemap/` as `sitemap-N.xml` parts plus the index `sitemap.xml`. Light DBAL queries with
 * keyset pagination, so memory does not depend on the number of events.
 *
 * Atomicity: parts are replaced in place first, the index last, stale higher-numbered parts are deleted after it.
 * An index never points at a missing part; a crawler that fetches an old index while parts are being replaced may
 * see a part of the newer run, which is harmless (a list of URLs).
 */
class SitemapGenerator
{
    public const string DIRECTORY = 'sitemap';
    public const string INDEX = 'sitemap/sitemap.xml';
    public const int DEFAULT_MAX_URLS = 10000;
    private const int FEED_BATCH = 200;

    public function __construct(
        #[Autowire(service: 'app.storage', lazy: true)]
        private readonly FilesystemOperator $storage,
        private readonly Connection $db,
        private readonly ClockInterface $clock,
        #[Autowire(env: 'APP_URL')]
        private readonly string $appUrl,
        #[Autowire(env: 'FRONTEND_URL')]
        private readonly string $frontendUrl,
        #[Autowire(env: 'int:SITEMAP_EVENTS_FUTURE_MONTHS')]
        private readonly int $futureMonths = 12,
        private readonly int $maxUrlsPerFile = self::DEFAULT_MAX_URLS,
        private readonly int $eventBatch = 1000,
    ) {
        if ($futureMonths < 0) {
            throw new \InvalidArgumentException(sprintf('SITEMAP_EVENTS_FUTURE_MONTHS must be an integer >= 0, got %d', $futureMonths));
        }
        if ($maxUrlsPerFile < 1 || $eventBatch < 1) {
            throw new \InvalidArgumentException('Sitemap sizes must be >= 1.');
        }
    }

    public function generate(): SitemapResult
    {
        $page = rtrim($this->frontendUrl, '/');
        $now = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'));
        $from = $now->modify('-1 day')->format('Y-m-d');
        $to = $now->modify(sprintf('+%d months', $this->futureMonths))->format('Y-m-d');

        /** @var list<array{name: string, lastmod: ?string}> $parts */
        $parts = [];
        $part = null;
        $urls = 0;
        $feeds = 0;

        $emit = function (string $loc, ?string $lastmod) use (&$part, &$parts, &$urls): void {
            if (null !== $part && $part->count >= $this->maxUrlsPerFile) {
                $parts[] = $this->closePart($part, count($parts) + 1);
                $part = null;
            }
            $part ??= new SitemapPart();
            $part->add($loc, $lastmod);
            ++$urls;
        };

        foreach ($this->publicFeeds() as [$feedId, $feedUpdated]) {
            ++$feeds;
            $emit($page.'/feed/'.$feedId, self::lastmod($feedUpdated));
            if ($this->futureMonths > 0) {
                foreach ($this->events($feedId, $from, $to) as [$eventId, $eventUpdated]) {
                    $emit($page.'/feed/'.$feedId.'/events/'.$eventId, self::lastmod($eventUpdated));
                }
            }
        }
        // Zero URLs still yields one valid, empty urlset so the index is never empty.
        $parts[] = $this->closePart($part ?? new SitemapPart(), count($parts) + 1);

        $this->writeIndex($parts);
        $this->deleteStaleParts(count($parts));

        return new SitemapResult(array_map(static fn (array $p): string => $p['name'], $parts), $urls, $feeds);
    }

    /** @return \Generator<int, array{string, string}> feed id, updated_at, ordered by id */
    private function publicFeeds(): \Generator
    {
        $after = '';
        while (true) {
            $rows = $this->db->fetchAllNumeric(
                'SELECT f.id, f.updated_at FROM calendar_feed f
                 WHERE f.visibility = ? AND f.id > ?
                   AND EXISTS (SELECT 1 FROM calendar_feed_calendar fc JOIN calendar c ON c.id = fc.calendar_id
                               WHERE fc.feed_id = f.id AND c.archived_at IS NULL)
                 ORDER BY f.id LIMIT '.self::FEED_BATCH,
                [FeedVisibility::PUBLIC->value, $after],
            );
            foreach ($rows as $row) {
                yield [(string) $row[0], (string) $row[1]];
            }
            if (count($rows) < self::FEED_BATCH) {
                return;
            }
            $after = (string) $rows[count($rows) - 1][0];
        }
    }

    /**
     * Same selection as the public web view (PublicFeedService::restrictToFeed): published events of the feed's
     * non-archived calendars, limited to the feed's own target groups when it has any; days overlapping the window.
     *
     * @return \Generator<int, array{string, string}> event id, updated_at, ordered by id
     */
    private function events(string $feedId, string $from, string $to): \Generator
    {
        $calendarIds = $this->db->fetchFirstColumn(
            'SELECT c.id FROM calendar_feed_calendar fc JOIN calendar c ON c.id = fc.calendar_id
             WHERE fc.feed_id = ? AND c.archived_at IS NULL',
            [$feedId],
        );
        if ([] === $calendarIds) {
            return;
        }
        $groupIds = $this->db->fetchFirstColumn('SELECT target_group_id FROM calendar_feed_target_group WHERE feed_id = ?', [$feedId]);

        $sql = 'SELECT e.id, e.updated_at FROM event e
                WHERE e.calendar_id IN (?) AND e.type = \'event\' AND e.is_draft = 0 AND e.id > ?
                  AND COALESCE(e.date_end, e.date) >= ? AND e.date <= ?';
        if ([] !== $groupIds) {
            $sql .= ' AND EXISTS (SELECT 1 FROM event_target_group etg WHERE etg.event_id = e.id AND etg.target_group_id IN (?))';
        }
        $sql .= ' ORDER BY e.id LIMIT '.$this->eventBatch;

        $after = '';
        while (true) {
            $params = [$calendarIds, $after, $from, $to];
            $types = [0 => ArrayParameterType::STRING];
            if ([] !== $groupIds) {
                $params[] = $groupIds;
                $types[4] = ArrayParameterType::STRING;
            }
            $rows = $this->db->fetchAllNumeric($sql, $params, $types);
            foreach ($rows as $row) {
                yield [(string) $row[0], (string) $row[1]];
            }
            if (count($rows) < $this->eventBatch) {
                return;
            }
            $after = (string) $rows[count($rows) - 1][0];
        }
    }

    /** @return array{name: string, lastmod: ?string} */
    private function closePart(SitemapPart $part, int $number): array
    {
        $name = sprintf('sitemap-%d.xml', $number);
        $stream = $part->finish();
        try {
            $this->storage->writeStream(self::DIRECTORY.'/'.$name, $stream);
        } finally {
            fclose($stream);
        }

        return ['name' => $name, 'lastmod' => $part->lastmod];
    }

    /** @param list<array{name: string, lastmod: ?string}> $parts */
    private function writeIndex(array $parts): void
    {
        $base = rtrim($this->appUrl, '/');
        $xml = '<?xml version="1.0" encoding="UTF-8"?>'."\n".'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'."\n";
        foreach ($parts as $part) {
            $xml .= '  <sitemap><loc>'.SitemapPart::escape($base.'/'.$part['name']).'</loc>';
            if (null !== $part['lastmod']) {
                $xml .= '<lastmod>'.$part['lastmod'].'</lastmod>';
            }
            $xml .= "</sitemap>\n";
        }
        $this->storage->write(self::INDEX, $xml.'</sitemapindex>'."\n");
    }

    private function deleteStaleParts(int $keep): void
    {
        foreach ($this->storage->listContents(self::DIRECTORY, false) as $item) {
            if (!$item->isFile()) {
                continue;
            }
            if (1 === preg_match('/^sitemap-(\d+)\.xml$/', basename($item->path()), $m) && (int) $m[1] > $keep) {
                $this->storage->delete($item->path());
            }
        }
    }

    private static function lastmod(string $dbDateTime): ?string
    {
        try {
            return (new \DateTimeImmutable($dbDateTime, new \DateTimeZone('UTC')))->format('Y-m-d\TH:i:s\Z');
        } catch (\Exception) {
            return null;
        }
    }
}
