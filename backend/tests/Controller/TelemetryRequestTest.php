<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

final class TelemetryRequestTest extends WebTestCase
{
    public function testRequestSucceedsWithUnreachableCollector(): void
    {
        $_SERVER['OTEL_EXPORTER_OTLP_ENDPOINT'] = $_ENV['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://127.0.0.1:1';
        try {
            $client = static::createClient();
            $client->disableReboot();
            $telemetry = static::getContainer()->get(\App\Telemetry\Telemetry::class);
            $telemetry->counter('test.hits')->add(1);
            $start = microtime(true);
            $client->request('GET', '/api/health');
            self::assertResponseIsSuccessful();
            self::assertLessThan(3.0, microtime(true) - $start);

            self::assertTrue($telemetry->isEnabled());
        } finally {
            unset($_SERVER['OTEL_EXPORTER_OTLP_ENDPOINT'], $_ENV['OTEL_EXPORTER_OTLP_ENDPOINT']);
        }
    }
}
