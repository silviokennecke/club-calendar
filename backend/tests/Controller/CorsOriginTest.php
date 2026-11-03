<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class CorsOriginTest extends WebTestCase
{
    private const string FRONTEND = 'http://localhost:5173';

    public function testConfiguredOriginIsAllowed(): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/health', [], [], ['HTTP_ORIGIN' => self::FRONTEND]);

        $this->assertSame(self::FRONTEND, $client->getResponse()->headers->get('Access-Control-Allow-Origin'));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('foreignOrigins')]
    public function testLookAlikeOriginGetsNoCorsHeaders(string $origin): void
    {
        $client = static::createClient();
        $client->request('GET', '/api/health', [], [], ['HTTP_ORIGIN' => $origin]);
        $this->assertNull($client->getResponse()->headers->get('Access-Control-Allow-Origin'));

        $client->request('OPTIONS', '/api/health', [], [], [
            'HTTP_ORIGIN' => $origin,
            'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        ]);
        $this->assertNull($client->getResponse()->headers->get('Access-Control-Allow-Origin'));
    }

    /** @return iterable<string, array{string}> */
    public static function foreignOrigins(): iterable
    {
        yield 'suffix' => [self::FRONTEND.'.evil.test'];
        yield 'longer port' => ['http://localhost:51730'];
        yield 'other host' => ['https://evil.test'];
    }
}
