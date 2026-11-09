<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueKeys;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

class OpaqueCheckCommandTest extends KernelTestCase
{
    private const VARS = ['OPAQUE_ENABLED', 'OPAQUE_OPRF_SEED', 'OPAQUE_SERVER_PRIVATE_KEY', 'OPAQUE_KEYS', 'OPAQUE_ACTIVE_KEY_ID', 'OPAQUE_ROLLOUT_PERCENT', 'OPAQUE_LEGACY_CUTOFF'];

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

    private static function set(string $id): string
    {
        return $id.':'.OpaqueKeys::encode(random_bytes(64)).':'.OpaqueKeys::encode(sodium_crypto_core_ristretto255_scalar_random());
    }

    /** @param array<string, string> $extra */
    private function checkKeys(array $extra): CommandTester
    {
        return $this->check($extra + ['OPAQUE_ENABLED' => 'true', 'OPAQUE_OPRF_SEED' => '', 'OPAQUE_SERVER_PRIVATE_KEY' => '', 'OPAQUE_KEYS' => '', 'OPAQUE_ACTIVE_KEY_ID' => '']);
    }

    public function testMultipleKeySetsPass(): void
    {
        $tester = $this->checkKeys(['OPAQUE_KEYS' => self::set('1').','.self::set('2'), 'OPAQUE_ACTIVE_KEY_ID' => '2']);

        self::assertSame(0, $tester->getStatusCode());
        self::assertStringContainsString('2 key set(s)', $tester->getDisplay());
        self::assertStringContainsString('active: 2', $tester->getDisplay());
    }

    public function testDuplicateKeyIdIsFatal(): void
    {
        $tester = $this->checkKeys(['OPAQUE_KEYS' => self::set('2').','.self::set('2'), 'OPAQUE_ACTIVE_KEY_ID' => '2']);

        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('defined twice', $tester->getDisplay());
    }

    public function testMissingActiveIdIsFatal(): void
    {
        $tester = $this->checkKeys(['OPAQUE_KEYS' => self::set('1'), 'OPAQUE_ACTIVE_KEY_ID' => '7']);

        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('OPAQUE_ACTIVE_KEY_ID', $tester->getDisplay());
    }

    public function testInvalidKeyInSetIsFatal(): void
    {
        $tester = $this->checkKeys(['OPAQUE_KEYS' => self::set('1').',2:abc:def', 'OPAQUE_ACTIVE_KEY_ID' => '1']);

        self::assertSame(1, $tester->getStatusCode());
        self::assertStringContainsString('OPAQUE_KEYS[2]', $tester->getDisplay());
    }

    public function testWarnsAboutUnreferencedAndUnknownKeys(): void
    {
        self::bootKernel();
        $em = static::getContainer()->get(\Doctrine\ORM\EntityManagerInterface::class);
        \App\Tests\Helper\DatabaseResetter::reset($em);
        $em->persist((new \App\Entity\User())->setName('U')->setEmail('u@example.com')->setIsEmailVerified(true)->setOpaque(str_repeat("\x01", 192), 1, 'gone'));
        $em->flush();

        $tester = $this->checkKeys(['OPAQUE_KEYS' => self::set('1').','.self::set('2'), 'OPAQUE_ACTIVE_KEY_ID' => '2']);

        self::assertSame(0, $tester->getStatusCode());
        self::assertStringContainsString('Key "1" is configured but no record references it', $tester->getDisplay());
        self::assertStringContainsString('reference key id "gone"', $tester->getDisplay());
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

    public function testCutoffWithPartialRolloutIsFatal(): void
    {
        foreach (['0', '99'] as $percent) {
            $tester = $this->check(['OPAQUE_ENABLED' => 'false', 'OPAQUE_ROLLOUT_PERCENT' => $percent, 'OPAQUE_LEGACY_CUTOFF' => '2026-12-31']);

            self::assertSame(1, $tester->getStatusCode());
            self::assertStringContainsString('OPAQUE_ROLLOUT_PERCENT is below 100', $tester->getDisplay());
        }
        // Without a cutoff a partial rollout is the normal staged rollout.
        self::assertSame(0, $this->check(['OPAQUE_ENABLED' => 'false', 'OPAQUE_ROLLOUT_PERCENT' => '50', 'OPAQUE_LEGACY_CUTOFF' => ''])->getStatusCode());
    }

    public function testValidRolloutConfigPasses(): void
    {
        $tester = $this->check(['OPAQUE_ENABLED' => 'false', 'OPAQUE_ROLLOUT_PERCENT' => '100', 'OPAQUE_LEGACY_CUTOFF' => '2026-12-31']);

        self::assertSame(0, $tester->getStatusCode());
    }
}
