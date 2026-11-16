<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class RobotsTest extends WebTestCase
{
    protected function tearDown(): void
    {
        unset($_SERVER['INSTANCE_PRIVATE'], $_ENV['INSTANCE_PRIVATE']);
        putenv('INSTANCE_PRIVATE');
        parent::tearDown();
    }

    private function fetch(?string $env, string $method = 'GET'): \Symfony\Component\HttpFoundation\Response
    {
        if (null !== $env) {
            $_SERVER['INSTANCE_PRIVATE'] = $_ENV['INSTANCE_PRIVATE'] = $env;
            putenv('INSTANCE_PRIVATE='.$env);
        }
        $client = static::createClient();
        $client->request($method, '/robots.txt');

        return $client->getResponse();
    }

    public function testPrivateBody(): void
    {
        $response = $this->fetch(null);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(
            "User-agent: *\nDisallow: /\nAllow: /feed/\nAllow: /api/feed/\nAllow: /assets/\nAllow: /sitemap\n\nSitemap: http://localhost:8080/sitemap.xml\n",
            $response->getContent(),
        );
    }

    public function testPublicBody(): void
    {
        $body = (string) $this->fetch('false')->getContent();
        $this->assertStringContainsString("User-agent: *\nDisallow: /api/\nAllow: /api/feed/\nAllow: /api/map/image/\n", $body);
        $this->assertStringContainsString("Disallow: /login\n", $body);
        $this->assertStringContainsString("Disallow: /profile\n", $body);
        $this->assertStringNotContainsString("Disallow: /\n", $body);
        $this->assertStringNotContainsString('Disallow: /feed', $body);
        $this->assertStringNotContainsString('Disallow: /help', $body);
        $this->assertStringNotContainsString('secret', $body);
        $this->assertStringContainsString("Sitemap: http://localhost:8080/sitemap.xml\n", $body);
    }

    public function testHeaders(): void
    {
        $response = $this->fetch(null);
        $this->assertSame('text/plain; charset=utf-8', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('max-age=3600', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('public', (string) $response->headers->get('Cache-Control'));
    }

    public function testHeadIsOk(): void
    {
        $this->assertSame(200, $this->fetch(null, 'HEAD')->getStatusCode());
    }
}
