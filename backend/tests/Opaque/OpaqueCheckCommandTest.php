<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueKeys;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

class OpaqueCheckCommandTest extends KernelTestCase
{
    private const VARS = ['OPAQUE_ENABLED', 'OPAQUE_OPRF_SEED', 'OPAQUE_SERVER_PRIVATE_KEY', 'OPAQUE_ROLLOUT_PERCENT', 'OPAQUE_LEGACY_CUTOFF'];

    /** @var array<string, array{0: string|false, 1: mixed, 2: mixed}> */
    private array $saved = [];

    protected function setUp(): void
    {
        foreach (self::VARS as $name) {
            $this->saved[$name] = [getenv($name), $_ENV[$name] ?? null, $_SERVER[$name] ?? null];
        }
    }

    protected function tearDown(): void
    {
        foreach ($this->saved as $name => [$env, $_env, $server]) {
            false === $env ? putenv($name) : putenv("$name=$env");
            null === $_env ? $this->unsetGlobal($_ENV, $name) : $_ENV[$name] = $_env;
            null === $server ? $this->unsetGlobal($_SERVER, $name) : $_SERVER[$name] = $server;
        }
        parent::tearDown();
    }

    /** @param array<string, mixed> $array */
    private function unsetGlobal(array &$array, string $name): void
    {
        unset($array[$name]);
    }

    /** @param array<string, string> $env */
    private function check(array $env): CommandTester
    {
        foreach ($env as $name => $value) {
            putenv("$name=$value");
            $_ENV[$name] = $_SERVER[$name] = $value;
        }
        self::ensureKernelShutdown();
        self::bootKernel();
        $tester = new CommandTester((new Application(self::$kernel))->find('app:opaque:check'));
        $tester->execute([]);

        return $tester;
    }

    public function testDisabledSkipsTheCheck(): void
    {
        $tester = $this->check(['OPAQUE_ENABLED' => 'false']);

        self::assertSame(0, $tester->getStatusCode());
        self::assertStringContainsString('disabled', $tester->getDisplay());
    }

    public function testEnabledWithValidKeysPasses(): void
    {
        $tester = $this->check([
            'OPAQUE_ENABLED' => 'true',
            'OPAQUE_OPRF_SEED' => OpaqueKeys::encode(random_bytes(64)),
            'OPAQUE_SERVER_PRIVATE_KEY' => OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random()),
        ]);

        self::assertSame(0, $tester->getStatusCode());
    }

    public function testEnabledWithMissingKeysIsFatal(): void
    {
        $tester = $this->check(['OPAQUE_ENABLED' => 'true', 'OPAQUE_OPRF_SEED' => '', 'OPAQUE_SERVER_PRIVATE_KEY' => '']);

        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('OPAQUE_OPRF_SEED', $tester->getDisplay());
    }

    public function testEnabledWithInvalidKeyIsFatal(): void
    {
        $tester = $this->check([
            'OPAQUE_ENABLED' => 'true',
            'OPAQUE_OPRF_SEED' => OpaqueKeys::encode(random_bytes(64)),
            'OPAQUE_SERVER_PRIVATE_KEY' => OpaqueKeys::encode(str_repeat("\xff", 32)),
        ]);

        self::assertSame(1, $tester->getStatusCode());
    }

    /** @return iterable<string, array{string, string, string}> */
    public static function invalidRollout(): iterable
    {
        yield 'percent over 100' => ['101', '', 'OPAQUE_ROLLOUT_PERCENT'];
        yield 'negative percent' => ['-1', '', 'OPAQUE_ROLLOUT_PERCENT'];
        yield 'non-numeric percent' => ['half', '', 'OPAQUE_ROLLOUT_PERCENT'];
        yield 'decimal percent' => ['12.5', '', 'OPAQUE_ROLLOUT_PERCENT'];
        yield 'cutoff not ISO' => ['0', '31.12.2026', 'OPAQUE_LEGACY_CUTOFF'];
        yield 'cutoff impossible date' => ['0', '2026-02-30', 'OPAQUE_LEGACY_CUTOFF'];
        yield 'cutoff with time' => ['0', '2026-12-31T00:00:00', 'OPAQUE_LEGACY_CUTOFF'];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('invalidRollout')]
    public function testInvalidRolloutConfigIsFatalEvenWhenDisabled(string $percent, string $cutoff, string $expected): void
    {
        $tester = $this->check(['OPAQUE_ENABLED' => 'false', 'OPAQUE_ROLLOUT_PERCENT' => $percent, 'OPAQUE_LEGACY_CUTOFF' => $cutoff]);

        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString($expected, $tester->getDisplay());
    }

    public function testValidRolloutConfigPasses(): void
    {
        $tester = $this->check(['OPAQUE_ENABLED' => 'false', 'OPAQUE_ROLLOUT_PERCENT' => '100', 'OPAQUE_LEGACY_CUTOFF' => '2026-12-31']);

        self::assertSame(0, $tester->getStatusCode());
    }
}
