<?php

declare(strict_types=1);

namespace App\Tests\Telemetry;

use App\Logging\OtelLogHandler;
use App\Telemetry\Telemetry;
use App\Telemetry\TelemetryConfig;
use Monolog\Level;
use Monolog\Logger;
use OpenTelemetry\SDK\Logs\Exporter\InMemoryExporter;
use PHPUnit\Framework\TestCase;

final class OtelLogHandlerTest extends TestCase
{
    private \ArrayObject $storage;

    protected function setUp(): void
    {
        $this->storage = new \ArrayObject();
    }

    private function logger(TelemetryConfig $config, ?Telemetry &$telemetry = null): Logger
    {
        $telemetry = new Telemetry($config, null, null, new InMemoryExporter($this->storage));
        $logger = new Logger('app');
        $logger->pushProcessor(new \App\Logging\RedactTokensProcessor());
        $logger->pushHandler(new OtelLogHandler($config, $telemetry));

        return $logger;
    }

    public function testDisabledNeverBuildsProvider(): void
    {
        $logger = $this->logger(new TelemetryConfig(''), $t);
        $logger->error('boom');
        $t->flush();
        self::assertCount(0, $this->storage);
        self::assertNull($t->loggerProvider());

        $none = $this->logger(new TelemetryConfig('http://x', logsExporter: 'none'), $t2);
        $none->error('boom');
        $t2->flush();
        self::assertCount(0, $this->storage);
        self::assertNull($t2->loggerProvider());
        self::assertTrue($t2->isEnabled());
    }

    public function testExportsAtOrAboveLevelWithAttributes(): void
    {
        $logger = $this->logger(new TelemetryConfig('http://x', serviceName: 'svc', resourceAttributes: 'deployment.environment=prod'), $t);
        $logger->info('quiet');
        $logger->debug('quieter');
        $logger->warning('careful', ['userId' => 'u1']);
        self::assertCount(0, $this->storage, 'nothing is sent before the flush');
        $t->flush();

        self::assertCount(1, $this->storage);
        $record = $this->storage[0];
        self::assertSame('careful', $record->getBody());
        self::assertSame('WARNING', $record->getSeverityText());
        self::assertSame('app', $record->getInstrumentationScope()->getName());
        self::assertSame('svc', $record->getResource()->getAttributes()->get('service.name'));
        self::assertSame('prod', $record->getResource()->getAttributes()->get('deployment.environment'));
        self::assertSame('u1', $record->getAttributes()->get('context.userId'));
    }

    public function testInvalidLevelFallsBackToWarning(): void
    {
        $config = new TelemetryConfig('http://x', logsLevel: 'loud');
        self::assertSame('warning', $config->logsLevel);
        self::assertSame(Level::Warning, $config->monologLevel());
        self::assertSame(Level::Debug, (new TelemetryConfig('http://x', logsLevel: ' DEBUG '))->monologLevel());
    }

    public function testTokensAreMaskedBeforeExport(): void
    {
        $logger = $this->logger(new TelemetryConfig('http://x'), $t);
        $logger->error('Matched route GET /api/feed?secret=abc123def&x=1', [
            'header' => 'Authorization: Bearer abcdefghijklmnop',
            'token' => 'supersecretvalue',
        ]);
        $t->flush();
        $record = $this->storage[0];
        $dump = json_encode([$record->getBody(), $record->getAttributes()->toArray()]);
        foreach (['abc123def', 'abcdefghijklmnop', 'supersecretvalue'] as $secret) {
            self::assertStringNotContainsString($secret, $dump);
        }
    }

    public function testExceptionAttributes(): void
    {
        $logger = $this->logger(new TelemetryConfig('http://x'), $t);
        $logger->error('failed', ['exception' => new \RuntimeException('bad thing'), 'longValue' => str_repeat('x', 5000)]);
        $t->flush();
        $attrs = $this->storage[0]->getAttributes()->toArray();
        self::assertSame('RuntimeException', $attrs['exception.type']);
        self::assertSame('bad thing', $attrs['exception.message']);
        self::assertArrayNotHasKey('trace', $attrs['context']['exception']);
        self::assertLessThan(1100, mb_strlen($attrs['context.longValue']));
    }

    public function testUnreachableCollectorNeverThrowsNorBlocks(): void
    {
        $config = new TelemetryConfig('http://127.0.0.1:1', timeoutMs: 500);
        $telemetry = new Telemetry($config);
        $logger = new Logger('app');
        $logger->pushHandler(new OtelLogHandler($config, $telemetry));
        $start = microtime(true);
        $logger->error('one');
        $logger->critical('two', ['exception' => new \LogicException('x')]);
        $telemetry->flush();
        $telemetry->flush();
        self::assertLessThan(3.0, microtime(true) - $start);
    }
}
