<?php

declare(strict_types=1);

namespace App\Service;

use Doctrine\DBAL\Connection;
use Psr\Clock\ClockInterface;

/** Deletes dead-lettered messenger messages (queue "failed") older than 30 days. */
class FailedMessagePruner
{
    private const int BATCH = 1000;
    private const int MAX_BATCHES = 1000;

    public function __construct(
        private readonly Connection $connection,
        private readonly ClockInterface $clock,
    ) {
    }

    public function prune(): int
    {
        $cutoff = $this->clock->now()->setTimezone(new \DateTimeZone('UTC'))->modify('-30 days')->format('Y-m-d H:i:s');
        $total = 0;
        $batches = 0;
        do {
            $n = (int) $this->connection->executeStatement(
                sprintf('DELETE FROM messenger_messages WHERE queue_name = ? AND created_at < ? LIMIT %d', self::BATCH),
                ['failed', $cutoff],
            );
            $total += $n;
        } while ($n >= self::BATCH && ++$batches < self::MAX_BATCHES);

        return $total;
    }
}
