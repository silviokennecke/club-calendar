<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\EventListener\FeedResponseHeadersListener;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

class FeedResponseHeadersListenerTest extends TestCase
{
    /** @param array<string, mixed> $attributes */
    private function handle(string $uri, int $status = 404, array $attributes = [], int $type = HttpKernelInterface::MAIN_REQUEST): Response
    {
        $response = new Response('', $status);
        $request = Request::create($uri);
        foreach ($attributes as $key => $value) {
            $request->attributes->set($key, $value);
        }
        $event = new ResponseEvent($this->createStub(HttpKernelInterface::class), $request, $type, $response);
        (new FeedResponseHeadersListener())($event);

        return $response;
    }

    public function testFeedApiResponsesWithoutTheAttributeAreNoindexAndSendNoReferrer(): void
    {
        foreach (['/api/feed/f1/events?secret=x', '/api/feed/f1/events/e1', '/api/feed/f1/ics', '/api/feed/unknown/events'] as $uri) {
            foreach ([200, 403, 404] as $status) {
                $headers = $this->handle($uri, $status)->headers;
                $this->assertSame('no-referrer', $headers->get('Referrer-Policy'), $uri);
                $this->assertSame('noindex', $headers->get('X-Robots-Tag'), "$uri $status");
            }
        }
    }

    /** @return iterable<string, array{mixed, int, ?string}> */
    public static function robotsMatrix(): iterable
    {
        yield 'indexable feed, 200' => [true, 200, null];
        yield 'indexable feed, 304' => [true, 304, 'noindex'];
        yield 'indexable feed, 400 (invalid range)' => [true, 400, 'noindex'];
        yield 'indexable feed, 404 (unknown event)' => [true, 404, 'noindex'];
        yield 'indexable feed, 500' => [true, 500, 'noindex'];
        yield 'not indexable, 200' => [false, 200, 'noindex'];
        yield 'not indexable, 403' => [false, 403, 'noindex'];
        yield 'truthy but not true' => [1, 200, 'noindex'];
        yield 'string "true"' => ['true', 200, 'noindex'];
        yield 'null' => [null, 200, 'noindex'];
    }

    #[DataProvider('robotsMatrix')]
    public function testRobotsTagFollowsTheFeedAttribute(mixed $indexable, int $status, ?string $expected): void
    {
        foreach (['/api/feed/f1/events', '/api/feed/f1/events/e1', '/api/feed/f1/ics'] as $uri) {
            $headers = $this->handle($uri, $status, [FeedResponseHeadersListener::INDEXABLE_ATTRIBUTE => $indexable])->headers;
            $this->assertSame($expected, $headers->get('X-Robots-Tag'), $uri);
            $this->assertSame('no-referrer', $headers->get('Referrer-Policy'), $uri);
        }
    }

    public function testOtherResponsesAreLeftAlone(): void
    {
        foreach (['/api/health', '/api/feeds', '/feed/f1'] as $uri) {
            $headers = $this->handle($uri)->headers;
            $this->assertFalse($headers->has('Referrer-Policy'), $uri);
            $this->assertFalse($headers->has('X-Robots-Tag'), $uri);
        }
        $this->assertFalse($this->handle('/api/feed/f1/events', 404, [], HttpKernelInterface::SUB_REQUEST)->headers->has('X-Robots-Tag'));
    }
}
