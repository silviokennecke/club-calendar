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

    /**
     * Zero deltas for every valid label set (only ICS can answer 304; the personal subscription serves ICS only),
     * so a rare first request is not the first sample of its series (Prometheus increase() cannot see that one).
     */
    public function initialize(): void
    {
        try {
            $counter = $this->telemetry->counter(self::NAME, '{request}', 'Feed requests served or answered 304');
            $sets = [self::MY_SUBSCRIPTION => ['ics' => ['200', '304']]];
            foreach (['public', 'club', 'private'] as $visibility) {
                $sets[$visibility] = ['ics' => ['200', '304'], 'web' => ['200'], 'event' => ['200'], 'event_ics' => ['200']];
            }
            foreach ($sets as $visibility => $kinds) {
                foreach ($kinds as $kind => $statuses) {
                    foreach ($statuses as $status) {
                        $counter->add(0, ['visibility' => $visibility, 'kind' => $kind, 'status' => $status]);
                    }
                }
            }
        } catch (\Throwable) {
        }
    }
}
