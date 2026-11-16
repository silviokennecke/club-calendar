<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class InstanceVisibilityTest extends WebTestCase
{
    protected function tearDown(): void
    {
        unset($_SERVER['INSTANCE_PRIVATE'], $_ENV['INSTANCE_PRIVATE']);
        putenv('INSTANCE_PRIVATE');
        parent::tearDown();
    }

    private function robots(?string $env): ?string
    {
        if (null !== $env) {
            $_SERVER['INSTANCE_PRIVATE'] = $_ENV['INSTANCE_PRIVATE'] = $env;
            putenv('INSTANCE_PRIVATE='.$env);
        }
        $client = static::createClient();
        $client->request('GET', '/api/health');

        return $client->getResponse()->headers->get('X-Robots-Tag');
    }

    public function testDefaultIsPrivate(): void
    {
        $this->assertSame('noindex', $this->robots(null));
    }

    public function testFalseAddsNoHeader(): void
    {
        $this->assertNull($this->robots('false'));
    }
}
