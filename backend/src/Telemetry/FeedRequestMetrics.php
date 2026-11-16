<?php

declare(strict_types=1);

namespace App\Telemetry;

/**
 * Delta counter of served feed requests. Callers record only after access was granted, so guessing ids or
 * secrets (404/403) never moves it. No feed, club or user attribute on purpose.
 */
final class FeedRequestMetrics
{
    public const NAME = 'club_calendar.feed.requests';
    public const MY_SUBSCRIPTION = 'my_subscription';

    public function __construct(private readonly Telemetry $telemetry)
    {
    }

    /** @param string $visibility public|club|private|my_subscription; $kind ics|web|event|event_ics */
    public function record(string $visibility, string $kind, int $status = 200): void
    {
        try {
            $this->telemetry->counter(self::NAME, '{request}', 'Feed requests served or answered 304')
                ->add(1, ['visibility' => strtolower($visibility), 'kind' => $kind, 'status' => (string) $status]);
        } catch (\Throwable) {
        }
    }
}
