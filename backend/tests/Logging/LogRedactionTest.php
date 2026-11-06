<?php

declare(strict_types=1);

namespace App\Tests\Logging;

use Monolog\Handler\TestHandler;
use Monolog\Logger;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

class LogRedactionTest extends KernelTestCase
{
    public function testConfiguredLoggerRedactsTokensInMessageContextAndExceptions(): void
    {
        self::bootKernel();
        $logger = static::getContainer()->get(LoggerInterface::class);
        $this->assertInstanceOf(Logger::class, $logger);
        $handler = new TestHandler();
        $logger->pushHandler($handler);

        $url = 'https://api.mapbox.com/styles/v1/x?access_token=pk.leak&foo=1';
        $logger->error("failed for $url", [
            'exception' => new \RuntimeException("HTTP 401 returned for \"$url\"", 0, new \LogicException($url)),
            'url' => $url,
        ]);

        $this->assertCount(1, $handler->getRecords());
        $record = $handler->getRecords()[0];
        $dump = json_encode([$record->message, $record->context], JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('pk.leak', $dump);
        $this->assertStringContainsString('access_token=[redacted]&foo=1', $record->message);
    }
}
