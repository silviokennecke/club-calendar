<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\Passkey;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/** Two parallel deletes of two different passkeys must not remove the last MFA factor (real processes, pcntl_fork). */
class PasskeyDeleteConcurrencyTest extends WebTestCase
{
    protected function setUp(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('pcntl is required');
        }
        self::ensureKernelShutdown();
        static::createClient();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));
    }

    public function testParallelDeletesOfTwoPasskeysLeaveOne(): void
    {
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', true);
        $user->setMfaEnforced(true);
        foreach (['pk-1', 'pk-2'] as $id) {
            $em->persist((new Passkey())->setId($id)->setUser($user)->setCredentialId('cred-'.$id)->setPublicKey('key')->setCounter(0));
        }
        $em->flush();
        $auth = 'Bearer '.$c->get(TokenService::class)->createAccessToken($user);

        $dir = dirname(__DIR__, 2).'/var';
        $startAt = microtime(true) + 3.0;
        $files = $pids = [];
        $c->get(Connection::class)->close();
        self::ensureKernelShutdown();
        foreach (['pk-1', 'pk-2'] as $i => $id) {
            $files[$i] = tempnam($dir, 'passkey-race-');
            $pid = pcntl_fork();
            if (0 === $pid) {
                $result = ['status' => 0, 'code' => 'child failed'];
                try {
                    self::ensureKernelShutdown();
                    $client = static::createClient();
                    $client->disableReboot();
                    while (microtime(true) < $startAt) {
                        usleep(500);
                    }
                    $r = TestHelper::jsonRequest($client, 'DELETE', '/api/auth/webauthn/'.$id, ['password' => 'password123'], $auth);
                    $result = ['status' => $r['status'], 'code' => $r['body']['code'] ?? null];
                } catch (\Throwable $e) {
                    $result['code'] = $e->getMessage();
                }
                file_put_contents($files[$i], json_encode($result));
                exit(0);
            }
            $this->assertGreaterThan(0, $pid);
            $pids[] = $pid;
        }
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $results = [];
        foreach ($files as $file) {
            $results[] = json_decode((string) file_get_contents($file), true);
            unlink($file);
        }
        self::ensureKernelShutdown();
        static::createClient();

        usort($results, fn ($a, $b) => $a['status'] <=> $b['status']);
        $this->assertSame([200, 422], array_column($results, 'status'), json_encode($results));
        $this->assertSame('mfa_last_passkey', $results[1]['code']);
        $this->assertSame(1, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM passkey'));
    }
}
