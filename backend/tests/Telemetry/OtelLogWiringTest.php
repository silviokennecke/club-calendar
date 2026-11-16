<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Telemetry\Telemetry;
use App\Tests\Helper\TelemetryCapture;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

final class OtelLogWiringTest extends KernelTestCase
{
    use TelemetryCapture;

    protected function tearDown(): void
    {
        $this->resetTelemetryEnv();
        putenv('OTEL_LOGS_EXPORTER');
        unset($_ENV['OTEL_LOGS_EXPORTER'], $_SERVER['OTEL_LOGS_EXPORTER']);
        parent::tearDown();
    }

    public function testMonologReachesExporterWhenEnabled(): void
    {
        $this->enableTelemetry();
        self::bootKernel();
        $c = static::getContainer();
        $c->get(LoggerInterface::class)->warning('wired up', ['k' => 'v']);
        $c->get(LoggerInterface::class)->info('below level');
        $c->get(Telemetry::class)->flush();

        $storage = $c->get('test.telemetry.log_storage');
        self::assertCount(1, $storage);
        self::assertSame('wired up', $storage[0]->getBody());
        self::assertSame('app', $storage[0]->getInstrumentationScope()->getName());
    }

    public function testDisabledByDefaultInTest(): void
    {
        $this->enableTelemetry(false);
        self::bootKernel();
        $c = static::getContainer();
        $c->get(LoggerInterface::class)->error('nothing');
        $c->get(Telemetry::class)->flush();
        self::assertCount(0, $c->get('test.telemetry.log_storage'));
        self::assertNull($c->get(Telemetry::class)->loggerProvider());
    }

    public function testLogsNoneKeepsMetrics(): void
    {
        $this->enableTelemetry();
        putenv('OTEL_LOGS_EXPORTER=none');
        $_ENV['OTEL_LOGS_EXPORTER'] = $_SERVER['OTEL_LOGS_EXPORTER'] = 'none';
        self::bootKernel();
        $c = static::getContainer();
        $c->get(LoggerInterface::class)->error('dropped');
        $t = $c->get(Telemetry::class);
        $t->counter('probe')->add(1);
        $t->flush();
        self::assertCount(0, $c->get('test.telemetry.log_storage'));
        self::assertSame(1, $this->points('probe')[0]['value']);
    }
}
