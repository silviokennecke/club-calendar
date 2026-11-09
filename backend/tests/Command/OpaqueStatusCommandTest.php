<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Console\Tester\CommandTester;

class OpaqueStatusCommandTest extends KernelTestCase
{
    private function add(string $email, bool $bcrypt, bool $record): void
    {
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $user = (new User())->setName('U')->setEmail($email)->setIsEmailVerified(true);
        if ($bcrypt) {
            $user->setPassword('$2y$04$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
        }
        if ($record) {
            $user->setOpaque(str_repeat("\x01", 192), 1, '1');
        }
        $em->persist($user);
        $em->flush();
    }

    public function testCountsAccountsByCredential(): void
    {
        self::bootKernel();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));
        $this->add('a@example.com', true, false);
        $this->add('b@example.com', true, false);
        $this->add('c@example.com', true, true);
        $this->add('d@example.com', false, true);
        $this->add('e@example.com', false, false);

        $tester = new CommandTester((new Application(self::$kernel))->find('app:opaque:status'));
        $tester->execute(['--json' => true]);

        $data = json_decode($tester->getDisplay(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(0, $tester->getStatusCode());
        self::assertSame(5, $data['total']);
        self::assertSame(2, $data['withRecord']);
        self::assertSame(2, $data['bcryptOnly']);
        self::assertSame(1, $data['both']);
        self::assertSame(1, $data['noPassword']);
        self::assertEquals(50.0, $data['migratedPercent']);
        self::assertStringNotContainsString('@example.com', $tester->getDisplay());

        $tester->execute([]);
        self::assertStringContainsString('Migrated: 50 %', $tester->getDisplay());
        self::assertStringContainsString('OPAQUE_ROLLOUT_PERCENT', $tester->getDisplay());
    }

    public function testEmptyDatabase(): void
    {
        self::bootKernel();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));

        $tester = new CommandTester((new Application(self::$kernel))->find('app:opaque:status'));
        $tester->execute(['--json' => true]);

        $data = json_decode($tester->getDisplay(), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(0, $data['total']);
        self::assertEquals(0.0, $data['migratedPercent']);
    }
}
