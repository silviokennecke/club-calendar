<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

/** HEAD and script-name-prefixed paths must not get past the access rules of signed-in-only routes. */
class AccessControlBypassTest extends WebTestCase
{
    #[\PHPUnit\Framework\Attributes\DataProvider('signedInOnlyPaths')]
    public function testHeadWithoutTokenIsUnauthorized(string $path): void
    {
        $client = static::createClient();
        $client->request('HEAD', $path);

        $this->assertSame(401, $client->getResponse()->getStatusCode());
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('signedInOnlyPaths')]
    public function testScriptNamePrefixedPathIsNotPublic(string $path): void
    {
        $client = static::createClient();
        $client->request('GET', '/index.php'.$path);

        $this->assertContains($client->getResponse()->getStatusCode(), [401, 404]);
    }

    /** @return iterable<string, array{string}> */
    public static function signedInOnlyPaths(): iterable
    {
        yield 'clubs' => ['/api/clubs'];
        yield 'me' => ['/api/auth/me'];
        yield 'calendars' => ['/api/calendars/x/events'];
    }
}
