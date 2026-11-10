<?php

declare(strict_types=1);

namespace App\Tests\Command;

use App\Entity\CalendarFeed;
use App\Entity\MemberSubscription;
use App\Enum\FeedVisibility;
use App\Security\Secret\SecretCipher;
use App\Security\Secret\SecretRotator;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Console\Application;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** app:secrets:rotate */
class SecretsRotateCommandTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;
    private Connection $conn;
    private string $feedId;
    private string $subId;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
        $this->conn = self::$em->getConnection();
        $hasher = static::getContainer()->get(UserPasswordHasherInterface::class);
        $user = TestHelper::createUser(self::$em, $hasher, 'a@example.com');
        $club = TestHelper::createClub(self::$em, $user);
        $cal = TestHelper::createCalendar(self::$em, $club);
        $feed = TestHelper::createFeed(self::$em, $club, [$cal], FeedVisibility::PRIVATE, 'F', 'feed-secret-value');
        $sub = new MemberSubscription($club, $user);
        self::$em->persist($sub);
        self::$em->flush();
        $this->feedId = $feed->getId();
        $this->subId = $sub->getId();
        self::$em->clear();
    }

    protected function tearDown(): void
    {
        // keep the kernel alive across tests
    }

    private function rotateCommand(array $input = []): CommandTester
    {
        $t = new CommandTester((new Application(self::$client->getKernel()))->find('app:secrets:rotate'));
        $t->execute($input);

        return $t;
    }

    private function feedRaw(): string
    {
        return (string) $this->conn->fetchOne('SELECT shared_secret FROM calendar_feed WHERE id = ?', [$this->feedId]);
    }

    private function subRaw(): string
    {
        return (string) $this->conn->fetchOne('SELECT secret FROM member_subscription WHERE id = ?', [$this->subId]);
    }

    private function makeLegacy(): void
    {
        $this->conn->executeStatement('UPDATE calendar_feed SET shared_secret = ? WHERE id = ?', ['legacy-feed', $this->feedId]);
        $this->conn->executeStatement('UPDATE member_subscription SET secret = ? WHERE id = ?', ['legacy-sub', $this->subId]);
    }

    public function testDryRunCountsAndChangesNothing(): void
    {
        $this->makeLegacy();
        $t = $this->rotateCommand(['--dry-run' => true]);
        $this->assertSame(Command::SUCCESS, $t->getStatusCode());
        $this->assertSame('legacy-feed', $this->feedRaw());
        $this->assertSame('legacy-sub', $this->subRaw());
        $this->assertStringContainsString('calendar_feed.shared_secret', $t->getDisplay());
        $this->assertStringContainsString('Would rewrite', $t->getDisplay());
    }

    public function testLegacyPlaintextGetsEncryptedAndRunIsIdempotent(): void
    {
        $this->makeLegacy();
        $this->assertSame(Command::SUCCESS, $this->rotateCommand()->getStatusCode());
        $feed = $this->feedRaw();
        $sub = $this->subRaw();
        $this->assertStringStartsWith('enc:v1:', $feed);
        $this->assertStringStartsWith('enc:v1:', $sub);

        $this->assertSame(Command::SUCCESS, $this->rotateCommand()->getStatusCode());
        $this->assertSame($feed, $this->feedRaw());
        $this->assertSame($sub, $this->subRaw());

        self::$em->clear();
        $this->assertSame('legacy-feed', self::$em->find(CalendarFeed::class, $this->feedId)->getSharedSecret());
        $this->assertSame('legacy-sub', self::$em->find(MemberSubscription::class, $this->subId)->getSecret());
    }

    public function testRotationFromOldKeyKeepsPlaintextAndLeavesAuditFieldsAlone(): void
    {
        $old = new SecretCipher('old-app-secret');
        $this->conn->executeStatement('UPDATE calendar_feed SET shared_secret = ? WHERE id = ?', [$old->encrypt('feed-plain', SecretCipher::PURPOSE_FEED), $this->feedId]);
        $this->conn->executeStatement('UPDATE member_subscription SET secret = ? WHERE id = ?', [$old->encrypt('sub-plain', SecretCipher::PURPOSE_SUBSCRIPTION), $this->subId]);
        $updatedBefore = $this->conn->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$this->feedId]);
        $versionBefore = $this->conn->fetchFirstColumn('SELECT content_version FROM calendar');

        $rotator = new SecretRotator($this->conn, new SecretCipher('new-app-secret', 'old-app-secret'));
        $result = $rotator->rotate(false);
        $this->assertSame([1, 1], array_column($result, 'rewritten'));
        $this->assertSame([], array_merge(...array_column($result, 'failedIds')));

        $new = new SecretCipher('new-app-secret');
        $this->assertSame('feed-plain', $new->decrypt($this->feedRaw(), SecretCipher::PURPOSE_FEED));
        $this->assertSame('sub-plain', $new->decrypt($this->subRaw(), SecretCipher::PURPOSE_SUBSCRIPTION));
        $this->assertTrue($new->usesCurrentKey($this->feedRaw()));
        $this->assertSame($updatedBefore, $this->conn->fetchOne('SELECT updated_at FROM calendar_feed WHERE id = ?', [$this->feedId]));
        $this->assertSame($versionBefore, $this->conn->fetchFirstColumn('SELECT content_version FROM calendar'));

        $again = $rotator->rotate(false);
        $this->assertSame([0, 0], array_column($again, 'rewritten'));
        $this->assertSame([1, 1], array_column($again, 'current'));
    }

    public function testUndecryptableRowFailsWithIdsButNeverValues(): void
    {
        $foreign = (new SecretCipher('some-lost-secret'))->encrypt('lost-value', SecretCipher::PURPOSE_FEED);
        $this->conn->executeStatement('UPDATE calendar_feed SET shared_secret = ? WHERE id = ?', [$foreign, $this->feedId]);
        $this->conn->executeStatement('UPDATE member_subscription SET secret = ? WHERE id = ?', ['legacy-sub', $this->subId]);

        $t = $this->rotateCommand();
        $this->assertSame(Command::FAILURE, $t->getStatusCode());
        $this->assertStringContainsString($this->feedId, $t->getDisplay());
        $this->assertStringNotContainsString('lost-value', $t->getDisplay());
        $this->assertStringNotContainsString($foreign, $t->getDisplay());
        $this->assertSame($foreign, $this->feedRaw(), 'failed rows are left untouched');
        $this->assertStringStartsWith('enc:v1:', $this->subRaw(), 'other rows are still processed');
    }
}
