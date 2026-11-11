<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Security\Location;
use App\Security\LocationResolver;
use App\Service\PasswordResetService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Mime\Email;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Security events of password change/reset: stored with client context, mail shows it in the account language. */
class SecurityEventTest extends WebTestCase
{
    private KernelBrowser $client;
    private EntityManagerInterface $em;

    protected function setUp(): void
    {
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        $c = static::getContainer();
        $c->set(LocationResolver::class, new class implements LocationResolver {
            public function resolve(Request $request): Location
            {
                return 'none' === $request->headers->get('X-Test-Location') ? new Location() : new Location('Köln', 'DE');
            }
        });
        $this->em = $c->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
    }

    private function user(string $language = 'en'): User
    {
        $user = TestHelper::createUser($this->em, static::getContainer()->get(UserPasswordHasherInterface::class), 'alice@example.com');
        $user->setLanguage($language)->setName('Alice');
        $this->em->flush();

        return $user;
    }

    private function change(User $user, array $server = []): void
    {
        $this->client->request('POST', '/api/auth/change-password', [], [], array_merge([
            'CONTENT_TYPE' => 'application/json',
            'HTTP_AUTHORIZATION' => 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user),
            'HTTP_USER_AGENT' => 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'REMOTE_ADDR' => '203.0.113.7',
        ], $server), json_encode(['currentPassword' => 'password123', 'newPassword' => 'new-password-1']));
        $this->assertSame(200, $this->client->getResponse()->getStatusCode(), (string) $this->client->getResponse()->getContent());
    }

    /** @return list<array<string, mixed>> */
    private function events(): array
    {
        return static::getContainer()->get(Connection::class)->fetchAllAssociative('SELECT * FROM security_event');
    }

    private function mail(): Email
    {
        $mails = array_values(array_filter($this->getMailerMessages(), fn ($m) => $m instanceof Email));
        $this->assertCount(1, $mails);

        return $mails[0];
    }

    public function testPasswordChangeStoresEventAndMailShowsContext(): void
    {
        $this->change($this->user('en'));

        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertSame('password_changed', $events[0]['type']);
        $this->assertSame('203.0.113.7', $events[0]['ip']);
        $this->assertSame('Köln', $events[0]['city']);
        $this->assertSame('DE', $events[0]['country']);
        $this->assertSame('Chrome 126', $events[0]['browser']);
        $this->assertSame(1, (int) $events[0]['success']);

        $html = (string) $this->mail()->getHtmlBody();
        $this->assertStringContainsString('203.0.113.7', $html);
        $this->assertStringContainsString('Köln, Germany', $html);
        $this->assertStringContainsString('Chrome 126', $html);
    }

    public function testMailIsInTheAccountLanguage(): void
    {
        $this->change($this->user('de'));
        $this->assertStringContainsString('Köln, Deutschland', (string) $this->mail()->getHtmlBody());
    }

    public function testUnknownValuesAreShownAsUnknown(): void
    {
        $this->change($this->user('en'), ['HTTP_X_TEST_LOCATION' => 'none', 'HTTP_USER_AGENT' => '']);
        $html = (string) $this->mail()->getHtmlBody();
        $this->assertStringContainsString('Location:</strong> unknown', $html);
        $this->assertStringContainsString('Browser:</strong> unknown', $html);
        $this->assertNull($this->events()[0]['city']);
    }

    public function testPasswordResetStoresEvent(): void
    {
        $user = $this->user('en');
        $token = static::getContainer()->get(PasswordResetService::class)->createToken($user);
        $this->client->request('POST', '/api/auth/reset-password', [], [], [
            'CONTENT_TYPE' => 'application/json', 'REMOTE_ADDR' => '203.0.113.8',
        ], json_encode(['token' => $token, 'password' => 'new-password-1']));
        $this->assertSame(204, $this->client->getResponse()->getStatusCode());
        $events = $this->events();
        $this->assertCount(1, $events);
        $this->assertSame('password_changed', $events[0]['type']);
        $this->assertSame('reset', $events[0]['method']);
        $this->assertSame('203.0.113.8', $events[0]['ip']);
    }

    public function testDeletingTheUserRemovesItsEvents(): void
    {
        $user = $this->user();
        $this->change($user);
        $this->assertCount(1, $this->events());
        $this->em->clear();
        $this->em->remove($this->em->find(User::class, $user->getId()));
        $this->em->flush();
        $this->assertCount(0, $this->events());
    }
}
