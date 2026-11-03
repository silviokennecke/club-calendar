<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\PasswordHasherFactory;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasher;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;
use Symfony\Component\Yaml\Yaml;

/**
 * The test environment hasher is a cheap `auto` (cost 5); the bcrypt-compatibility tests build the hasher from the
 * production security.yaml instead. A cost-4 hash is "outdated" for the test hasher and triggers the rehash.
 */
class PasswordHashingTest extends WebTestCase
{
    private static function productionHasher(): UserPasswordHasher
    {
        $config = Yaml::parseFile(__DIR__.'/../../config/packages/security.yaml');
        $factory = new PasswordHasherFactory(['App\Entity\User' => $config['security']['password_hashers'][User::class]]);

        return new UserPasswordHasher($factory);
    }

    private static function legacyBcrypt13(string $password): string
    {
        $prehash = (72 < \strlen($password) || str_contains($password, "\0")) ? base64_encode(hash('sha512', $password, true)) : $password;

        return password_hash($prehash, \PASSWORD_BCRYPT, ['cost' => 13]);
    }

    public function testProductionConfigIsAuto(): void
    {
        $config = Yaml::parseFile(__DIR__.'/../../config/packages/security.yaml');
        $this->assertSame('auto', $config['security']['password_hashers'][User::class]['algorithm']);
    }

    /** @return iterable<string, array{string}> */
    public static function passwords(): iterable
    {
        yield 'short' => ['password123'];
        yield 'exactly 72 bytes' => [str_repeat('a', 72)];
        yield 'over 72 bytes' => [str_repeat('b', 128)];
        yield 'multibyte over 72 bytes' => [str_repeat('é', 100)];
    }

    #[DataProvider('passwords')]
    public function testExistingBcryptCost13HashesStillVerify(string $password): void
    {
        $hasher = self::productionHasher();
        $user = (new User())->setPassword(self::legacyBcrypt13($password));

        $this->assertTrue($hasher->isPasswordValid($user, $password));
        $this->assertFalse($hasher->isPasswordValid($user, $password.'x'));
        $this->assertFalse($hasher->needsRehash($user));
    }

    public function testLoginUpgradesAnOutdatedHashWithoutEndingSessions(): void
    {
        $client = static::createClient();
        $container = static::getContainer();
        $em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);

        $user = TestHelper::createUser($em, $container->get(UserPasswordHasherInterface::class), 'old@example.com');
        $legacy = password_hash('password123', \PASSWORD_BCRYPT, ['cost' => 4]);
        $user->setPassword($legacy);
        $em->flush();
        $tokenVersion = $user->getTokenVersion();

        $wrong = TestHelper::jsonRequest($client, 'POST', '/api/auth/login', ['email' => 'old@example.com', 'password' => 'nope-nope']);
        $this->assertSame(401, $wrong['status']);
        $em->clear();
        $this->assertSame($legacy, $em->getRepository(User::class)->findOneBy(['email' => 'old@example.com'])->getPassword());

        $ok = TestHelper::jsonRequest($client, 'POST', '/api/auth/login', ['email' => 'old@example.com', 'password' => 'password123']);
        $this->assertSame(200, $ok['status']);

        $em->clear();
        $reloaded = $em->getRepository(User::class)->findOneBy(['email' => 'old@example.com']);
        $this->assertNotSame($legacy, $reloaded->getPassword());
        $this->assertStringStartsWith('$2y$05$', $reloaded->getPassword());
        $this->assertSame($tokenVersion, $reloaded->getTokenVersion());
        $this->assertTrue(self::productionHasher()->isPasswordValid($reloaded, 'password123'));

        // A session issued before the upgrade keeps working.
        $me = TestHelper::jsonRequest($client, 'GET', '/api/auth/me', [], 'Bearer '.$ok['body']['access_token']);
        $this->assertSame(200, $me['status']);
    }

    public function testLoginKeepsAnUpToDateHash(): void
    {
        $client = static::createClient();
        $container = static::getContainer();
        $em = $container->get(EntityManagerInterface::class);
        DatabaseResetter::reset($em);

        $user = TestHelper::createUser($em, $container->get(UserPasswordHasherInterface::class), 'new@example.com');
        $hash = $user->getPassword();

        $ok = TestHelper::jsonRequest($client, 'POST', '/api/auth/login', ['email' => 'new@example.com', 'password' => 'password123']);
        $this->assertSame(200, $ok['status']);
        $em->clear();
        $this->assertSame($hash, $em->getRepository(User::class)->findOneBy(['email' => 'new@example.com'])->getPassword());
    }
}
