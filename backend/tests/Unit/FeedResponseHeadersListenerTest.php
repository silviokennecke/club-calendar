<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\EventListener\FeedResponseHeadersListener;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;

class FeedResponseHeadersListenerTest extends TestCase
{
    private function handle(string $uri, int $type = HttpKernelInterface::MAIN_REQUEST): Response
    {
        $response = new Response('', 404);
        $event = new ResponseEvent($this->createStub(HttpKernelInterface::class), Request::create($uri), $type, $response);
        (new FeedResponseHeadersListener())($event);

        return $response;
    }

    public function testFeedApiResponsesAreNoindexAndSendNoReferrer(): void
    {
        foreach (['/api/feed/f1/events?secret=x', '/api/feed/f1/events/e1', '/api/feed/f1/ics', '/api/feed/unknown/events'] as $uri) {
            $headers = $this->handle($uri)->headers;
            $this->assertSame('no-referrer', $headers->get('Referrer-Policy'), $uri);
            $this->assertSame('noindex', $headers->get('X-Robots-Tag'), $uri);
        }
    }

    public function testOtherResponsesAreLeftAlone(): void
    {
        foreach (['/api/health', '/api/feeds', '/feed/f1'] as $uri) {
            $headers = $this->handle($uri)->headers;
            $this->assertFalse($headers->has('Referrer-Policy'), $uri);
            $this->assertFalse($headers->has('X-Robots-Tag'), $uri);
        }
        $this->assertFalse($this->handle('/api/feed/f1/events', HttpKernelInterface::SUB_REQUEST)->headers->has('X-Robots-Tag'));
    }
}
