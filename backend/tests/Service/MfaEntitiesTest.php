<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\MfaBackupCode;
use App\Entity\SecurityEvent;
use App\Entity\UserTotp;
use App\Enum\SecurityEventType;
use App\Repository\MfaBackupCodeRepository;
use App\Repository\SecurityEventRepository;
use App\Repository\UserTotpRepository;
use App\Security\Secret\SecretCipher;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Tools\SchemaTool;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

class MfaEntitiesTest extends KernelTestCase
{
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(string $email = 'a@example.com'): \App\Entity\User
    {
        return TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), $email);
    }

    public function testMigrationsMatchTheMappingForMfaTables(): void
    {
        $sql = (new SchemaTool($this->em))->getUpdateSchemaSql($this->em->getMetadataFactory()->getAllMetadata());
        $mine = array_values(array_filter($sql, fn (string $s) => 1 === preg_match('/user_totp|mfa_backup_code|security_event|mfa_enforced/', $s)));
        $this->assertSame([], $mine);
    }

    public function testTotpSecretIsEncryptedAndRoundTrips(): void
    {
        $user = $this->user();
        $totp = new UserTotp($user, 'JBSWY3DPEHPK3PXP');
        $this->em->persist($totp);
        $this->em->flush();

        $raw = (string) $this->em->getConnection()->fetchOne('SELECT secret FROM user_totp WHERE id = ?', [$totp->getId()]);
        $this->assertStringStartsWith('enc:v1:', $raw);
        $this->assertStringNotContainsString('JBSWY3DPEHPK3PXP', $raw);
        $this->assertSame('JBSWY3DPEHPK3PXP', static::getContainer()->get(SecretCipher::class)->decrypt($raw, SecretCipher::PURPOSE_TOTP));

        $this->em->clear();
        $repo = static::getContainer()->get(UserTotpRepository::class);
        $this->assertSame('JBSWY3DPEHPK3PXP', $repo->findOneByUser($this->em->find(\App\Entity\User::class, $user->getId()))->getSecret());
    }

    public function testAdvanceStepOnlyMovesForward(): void
    {
        $totp = new UserTotp($this->user(), 'JBSWY3DPEHPK3PXP');
        $this->em->persist($totp);
        $this->em->flush();
        $repo = static::getContainer()->get(UserTotpRepository::class);

        $this->assertTrue($repo->advanceStep($totp, 100));
        $this->assertFalse($repo->advanceStep($totp, 100));
        $this->assertFalse($repo->advanceStep($totp, 99));
        $this->assertTrue($repo->advanceStep($totp, 101));
    }

    public function testBackupCodeConsumeIsSingleUseAndCounted(): void
    {
        $user = $this->user();
        $other = $this->user('b@example.com');
        $hashA = hash('sha256', 'AAAA');
        $this->em->persist(new MfaBackupCode($user, $hashA));
        $this->em->persist(new MfaBackupCode($user, hash('sha256', 'BBBB')));
        $this->em->flush();
        $repo = static::getContainer()->get(MfaBackupCodeRepository::class);

        $this->assertSame(2, $repo->countUnused($user));
        $this->assertFalse($repo->consume($other, $hashA), 'a code of another user never matches');
        $this->assertTrue($repo->consume($user, $hashA));
        $this->assertFalse($repo->consume($user, $hashA));
        $this->assertSame(1, $repo->countUnused($user));
        $this->assertSame(2, $repo->countAll($user));
        $this->assertSame(2, $repo->deleteAll($user));
        $this->assertSame(0, $repo->countAll($user));
    }

    public function testSecurityEventsStoredPrunedAndRemovedWithUser(): void
    {
        $user = $this->user();
        $old = (new SecurityEvent($user, SecurityEventType::LOGIN, true, new \DateTimeImmutable('-400 days')))
            ->setContext('password', null, '203.0.113.5', 'Berlin', 'DE', 'Firefox on Linux');
        $recent = (new SecurityEvent($user, SecurityEventType::MFA_VERIFY, false))->setContext('totp', null, null, null, null, null);
        $this->em->persist($old);
        $this->em->persist($recent);
        $this->em->flush();
        $this->em->clear();

        $stored = $this->em->find(SecurityEvent::class, $old->getId());
        $this->assertSame(SecurityEventType::LOGIN, $stored->getType());
        $this->assertSame(1, $stored->getAttempts());
        $this->assertSame('DE', $stored->getCountry());

        $this->assertSame(1, static::getContainer()->get(SecurityEventRepository::class)->pruneBefore(new \DateTimeImmutable('-1 year')));

        $conn = $this->em->getConnection();
        $this->em->remove($this->em->find(\App\Entity\User::class, $user->getId()));
        $this->em->flush();
        $this->assertSame(0, (int) $conn->fetchOne('SELECT COUNT(*) FROM security_event'));
    }

    public function testUserMfaEnforcedFlag(): void
    {
        $user = $this->user();
        $this->assertFalse($user->isMfaEnforced());
        $user->setMfaEnforced(true);
        $this->em->flush();
        $this->em->clear();
        $loaded = $this->em->find(\App\Entity\User::class, $user->getId());
        $this->assertTrue($loaded->isMfaEnforced());
        $this->assertNotNull($loaded->getMfaEnforcedAt());
    }
}
