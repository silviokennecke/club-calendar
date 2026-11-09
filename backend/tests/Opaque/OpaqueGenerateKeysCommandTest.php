<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\OpaqueKeys;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

class OpaqueGenerateKeysCommandTest extends KernelTestCase
{
    private function tester(): CommandTester
    {
        self::bootKernel();

        return new CommandTester((new Application(self::$kernel))->find('app:opaque:generate-keys'));
    }

    public function testPrintsValidEnvSnippetToStdout(): void
    {
        $tester = $this->tester();

        self::assertSame(0, $tester->execute([], ['capture_stderr_separately' => true]));

        $out = $tester->getDisplay();
        self::assertSame(1, preg_match('/^OPAQUE_OPRF_SEED=(\S+)$/m', $out, $seed));
        self::assertSame(1, preg_match('/^OPAQUE_SERVER_PRIVATE_KEY=(\S+)$/m', $out, $key));
        self::assertStringNotContainsString('Store these', $out);
        self::assertStringContainsString('Store these', $tester->getErrorOutput());
        self::assertStringContainsString('scrollback', $tester->getErrorOutput());

        $keys = new OpaqueKeys($seed[1], $key[1]);
        self::assertSame(64, strlen($keys->oprfSeed()));
        self::assertSame(32, strlen($keys->serverPublicKey()));
    }

    public function testEveryRunIsFresh(): void
    {
        $tester = $this->tester();
        $tester->execute([]);
        $first = $tester->getDisplay();
        $tester->execute([]);

        self::assertNotSame($first, $tester->getDisplay());
    }
}
