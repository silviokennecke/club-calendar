<?php

declare(strict_types=1);

namespace App\Security;

use App\Exception\ApiProblemException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Exact budget of personal data exports: 1 per hour and 3 per day per user, N per day per client IP. Every
 * export takes one free slot per bucket (unique insert in `NonceStore`, so parallel requests cannot exceed
 * a bucket); a slot frees up when its window is over. A sliding-window limiter cannot refund, slots can:
 * {@see DataExportTicket::release()} deletes the slots of a failed export.
 */
readonly class DataExportBudget
{
    public const string USER_HOUR = 'data_export.user_hour';
    public const string USER_DAY = 'data_export.user_day';
    public const string IP_DAY = 'data_export.ip_day';
    public const int HOUR = 3600;
    public const int DAY = 86400;

    public function __construct(
        private NonceStore $nonces,
        #[Autowire('%app.data_export_ip_per_day%')]
        private int $ipPerDay,
    ) {
    }

    /** @throws ApiProblemException 429 `rate_limited` + `Retry-After` when a bucket is full (nothing stays taken) */
    public function acquire(string $userId, string $ip): DataExportTicket
    {
        $taken = [];
        $buckets = [
            [self::USER_HOUR, $userId, 1, self::HOUR],
            [self::USER_DAY, $userId, 3, self::DAY],
            [self::IP_DAY, $ip, $this->ipPerDay, self::DAY],
        ];
        foreach ($buckets as [$purpose, $subject, $limit, $window]) {
            $slot = $this->take($purpose, $subject, $limit, $window);
            if (null === $slot) {
                $ticket = new DataExportTicket($this->nonces, $taken);
                $ticket->release();

                throw new ApiProblemException(429, 'Too many requests', 'rate_limited', null, ['Retry-After' => (string) $this->retryAfter($purpose, $subject, $limit)]);
            }
            $taken[] = [$purpose, $slot];
        }

        return new DataExportTicket($this->nonces, $taken);
    }

    private function take(string $purpose, string $subject, int $limit, int $window): ?string
    {
        // the store keeps entries 60 s past the given time
        $expires = time() + $window - 60;
        foreach ($this->keys($subject, $limit) as $key) {
            if ($this->nonces->consume($purpose, $key, $expires)) {
                return $key;
            }
        }

        return null;
    }

    private function retryAfter(string $purpose, string $subject, int $limit): int
    {
        $live = $this->nonces->liveExpiries($purpose, $this->keys($subject, $limit));

        return [] === $live ? 1 : max(1, min($live) - time());
    }

    /** @return list<string> */
    private function keys(string $subject, int $limit): array
    {
        return array_map(static fn (int $i): string => $subject.'#'.$i, range(1, max(1, $limit)));
    }
}
