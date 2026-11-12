<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class ChangePasswordUrlTest extends WebTestCase
{
    public function testRedirectsToProfilePasswordSectionWithoutAuth(): void
    {
        $client = static::createClient();
        $client->request('GET', '/.well-known/change-password', [], [], [
            'HTTP_HOST' => 'localhost:9999',
            'HTTP_X_FORWARDED_HOST' => 'evil.example',
        ]);

        $r = $client->getResponse();
        self::assertSame(302, $r->getStatusCode());
        $location = (string) $r->headers->get('Location');
        self::assertStringEndsWith('/profile#pr-pw', $location);
        self::assertStringNotContainsString('evil.example', $location);
        self::assertStringNotContainsString('9999', $location);
    }
}
