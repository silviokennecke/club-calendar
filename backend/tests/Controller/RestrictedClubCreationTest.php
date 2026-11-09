<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Club;
use App\Entity\ClubUser;
use App\Entity\User;
use App\Enum\ClubRole;
use App\Service\ClubCreationPolicy;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** RESTRICT_CLUB_CREATION: API refusal, bootstrap exception, registration field and app:club:create. */
class RestrictedClubCreationTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function boot(bool $restrictClubs, bool $restrictRegistration): void
    {
        static::ensureKernelShutdown();
        $this->client = static::createClient();
        $this->client->disableReboot();
        $container = static::getContainer();
        $this->em = $container->get(EntityManagerInterface::class);
        $container->set(ClubCreationPolicy::class, new ClubCreationPolicy($this->em, $restrictClubs, $restrictRegistration));
        DatabaseResetter::reset($this->em);
    }

    private function user(string $email = 'u@example.com'): User
    {
        return TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email);
    }

    /** @return array{status: int, body: mixed} */
    private function create(User $user, string $name = 'New Club'): array
    {
        $auth = TestHelper::authHeader($user, static::getContainer()->get(TokenService::class));

        return TestHelper::jsonRequest($this->client, 'POST', '/api/clubs', ['name' => $name], $auth);
    }

    private function registration(): array
    {
        return TestHelper::jsonRequest($this->client, 'GET', '/api/auth/registration')['body'];
    }

    private function clubCount(): int
    {
        $this->em->clear();

        return $this->em->getRepository(Club::class)->count([]);
    }

    public function testFlagOffAllowsCreation(): void
    {
        $this->boot(false, false);
        $this->assertSame(201, $this->create($this->user())['status']);
        $this->assertTrue($this->registration()['clubCreationAllowed']);
    }

    public function testFlagOnWithoutBootstrapIsRefused(): void
    {
        $this->boot(true, false);
        $r = $this->create($this->user());
        $this->assertSame(403, $r['status']);
        $this->assertSame('club_creation_restricted', $r['body']['code']);
        $this->assertSame(0, $this->clubCount());
        $this->assertFalse($this->registration()['clubCreationAllowed']);
    }

    public function testBootstrapAllowsExactlyTheFirstClub(): void
    {
        $this->boot(true, true);
        $user = $this->user();
        $this->assertTrue($this->registration()['clubCreationAllowed']);

        $this->assertSame(201, $this->create($user)['status']);
        $this->assertSame(1, $this->clubCount());

        $r = $this->create($user, 'Second');
        $this->assertSame(403, $r['status']);
        $this->assertSame('club_creation_restricted', $r['body']['code']);
        $this->assertSame(1, $this->clubCount());
        $this->assertFalse($this->registration()['clubCreationAllowed']);
    }

    public function testRestrictedRegistrationAloneDoesNotRestrictClubs(): void
    {
        $this->boot(false, true);
        $user = $this->user();
        $this->assertSame(201, $this->create($user)['status']);
        $this->assertSame(201, $this->create($user, 'Another')['status']);
    }

    public function testExistingClubBlocksBootstrap(): void
    {
        $this->boot(true, true);
        TestHelper::createClub($this->em, $this->user('owner@example.com'));
        $this->assertSame(403, $this->create($this->user('other@example.com'))['status']);
    }

    private function command(): CommandTester
    {
        return new CommandTester((new Application($this->client->getKernel()))->find('app:club:create'));
    }

    public function testCommandBypassesRestrictionAndMakesAdmin(): void
    {
        $this->boot(true, false);
        $user = $this->user('admin@example.com');
        $t = $this->command();
        $code = $t->execute(['--name' => 'CLI Club', '--admin' => 'Admin@Example.com', '--timezone' => 'Europe/Vienna'], ['interactive' => false]);

        $this->assertSame(Command::SUCCESS, $code, $t->getDisplay());
        $this->em->clear();
        $club = $this->em->getRepository(Club::class)->findOneBy(['name' => 'CLI Club']);
        $this->assertNotNull($club);
        $this->assertSame('Europe/Vienna', $club->getTimezone());
        $membership = $this->em->getRepository(ClubUser::class)->findOneBy(['club' => $club, 'user' => $user->getId()]);
        $this->assertSame(ClubRole::ADMIN, $membership->getRole());
    }

    public function testCommandRejectsUnknownUserBadTimezoneAndMissingOptions(): void
    {
        $this->boot(true, false);
        $user = $this->user('admin@example.com');
        $t = $this->command();

        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'X', '--admin' => 'nobody@example.com'], ['interactive' => false]));
        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'X', '--admin' => $user->getId(), '--timezone' => 'Mars/Base'], ['interactive' => false]));
        $this->assertSame(Command::FAILURE, $t->execute(['--admin' => $user->getId()], ['interactive' => false]));
        $this->assertSame(0, $this->clubCount());
    }

    public function testCommandAcceptsUserIdAndPromptsInteractively(): void
    {
        $this->boot(true, false);
        $user = $this->user('admin@example.com');
        $t = $this->command();
        $t->setInputs(['Prompted Club', $user->getId()]);

        $this->assertSame(Command::SUCCESS, $t->execute([]), $t->getDisplay());
        $this->assertSame(1, $this->clubCount());
    }

    public function testCommandHonoursClubQuota(): void
    {
        $this->boot(true, false);
        $user = $this->user('admin@example.com');
        for ($i = 0; $i < 50; ++$i) {
            TestHelper::createClub($this->em, $user, 'C'.$i);
        }
        $t = $this->command();

        $this->assertSame(Command::FAILURE, $t->execute(['--name' => 'Over', '--admin' => $user->getId()], ['interactive' => false]));
        $this->assertSame(50, $this->clubCount());
    }
}
