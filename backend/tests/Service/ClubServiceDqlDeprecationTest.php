<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Service\ClubService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\Deprecations\Deprecation;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class ClubServiceDqlDeprecationTest extends KernelTestCase
{
    /** @var list<string> */
    private array $deprecations = [];

    protected function tearDown(): void
    {
        Deprecation::disable();
        restore_error_handler();
        parent::tearDown();
    }

    public function testClubQueriesRaiseNoDqlDeprecation(): void
    {
        self::bootKernel();
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class));
        TestHelper::createClub($em, $user);
        $service = $c->get(ClubService::class);

        set_error_handler(function (int $no, string $msg): bool {
            $this->deprecations[] = $msg;

            return true;
        }, E_USER_DEPRECATED);
        Deprecation::enableWithTriggerError();

        $service->listClubs($user);
        $service->listClubs($user, true);
        $em->beginTransaction();
        try {
            try {
                $service->assertNotLastMemberAnywhere($user);
            } catch (\Throwable) {
                // only the query matters
            }
        } finally {
            $em->rollback();
        }

        self::assertSame([], array_values(array_filter(
            $this->deprecations,
            static fn (string $m) => str_contains($m, 'join condition'),
        )));
    }
}
