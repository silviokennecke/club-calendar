<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\UserTotp;
use App\Security\Mfa\Totp;
use App\Service\MfaService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Races of the step-up confirmation against itself and the MFA sign-in (shared failure budget, TOTP step advance,
 * backup codes). Requests run in real parallel processes (pcntl_fork), see MfaConcurrencyTest.
 */
class StepUpConcurrencyTest extends WebTestCase
{
    private string $secret;
    private KernelBrowser $client;
    private string $auth;

    protected function setUp(): void
    {
        if (!function_exists('pcntl_fork')) {
            $this->markTestSkipped('pcntl is required');
        }
        self::ensureKernelShutdown();
        $this->client = static::createClient();
        DatabaseResetter::reset(static::getContainer()->get(EntityManagerInterface::class));
        $this->secret = Totp::generateSecret();
    }

    /** @return list<string> backup codes */
    private function user(): array
    {
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', true);
        $em->persist(new UserTotp($user, $this->secret));
        $user->setMfaEnforced(true);
        $em->flush();
        $this->auth = 'Bearer '.$c->get(TokenService::class)->tokenResponse($user)['access_token'];

        return $c->get(MfaService::class)->regenerateBackupCodes($user);
    }

    private function mfaToken(): string
    {
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'password123']);
        $this->assertTrue($r['body']['mfaRequired'] ?? false, $r['content']);

        return $r['body']['mfaToken'];
    }

    /** @return array{0: string, 1: array<string, mixed>, 2: string} */
    private function stepUp(string $method, string $code): array
    {
        return ['/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => $method, 'code' => $code]], $this->auth];
    }

    /** @return array{0: string, 1: array<string, mixed>, 2: string} */
    private function signIn(string $token, string $method, string $code): array
    {
        return ['/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => $method, 'code' => $code], ''];
    }

    /**
     * @param list<array{0: string, 1: array<string, mixed>, 2: string}> $requests POST path, body and Authorization header
     *
     * @return list<array{status: int, body: array<string, mixed>}>
     */
    private function parallel(array $requests): array
    {
        $dir = dirname(__DIR__, 2).'/var';
        $startAt = microtime(true) + 3.0;
        $files = $pids = [];
        static::getContainer()->get(Connection::class)->close();
        self::ensureKernelShutdown();
        foreach ($requests as $i => [$path, $body, $auth]) {
            $files[$i] = tempnam($dir, 'stepup-race-');
            $pid = pcntl_fork();
            if (0 === $pid) {
                $result = ['status' => 0, 'body' => ['error' => 'child failed']];
                try {
                    self::ensureKernelShutdown();
                    $client = static::createClient();
                    $client->disableReboot();
                    while (microtime(true) < $startAt) {
                        usleep(500);
                    }
                    $r = TestHelper::jsonRequest($client, 'POST', $path, $body, $auth);
                    $result = ['status' => $r['status'], 'body' => $r['body']];
                } catch (\Throwable $e) {
                    $result['body'] = ['error' => $e->getMessage()];
                }
                file_put_contents($files[$i], json_encode($result));
                exit(0);
            }
            $this->assertGreaterThan(0, $pid);
            $pids[$i] = $pid;
        }
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $out = [];
        foreach ($files as $i => $file) {
            $out[$i] = json_decode((string) file_get_contents($file), true) ?? ['status' => 0, 'body' => []];
            unlink($file);
        }
        self::ensureKernelShutdown();
        $this->client = static::createClient();

        return $out;
    }

    /** @param list<array{status: int, body: array<string, mixed>}> $results */
    private function codes(array $results): array
    {
        return array_count_values(array_map(static fn (array $r): string => (string) ($r['body']['code'] ?? $r['status']), $results));
    }

    public function testStepUpFailuresRespectTheSharedBudgetInParallel(): void
    {
        $this->user();
        $results = $this->parallel(array_fill(0, 9, $this->stepUp('totp', '000000')));

        $codes = $this->codes($results);
        $this->assertSame(5, $codes['invalid_mfa_code'] ?? 0, json_encode($results));
        $this->assertSame(4, $codes['rate_limited'] ?? 0, json_encode($results));
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/step-up', ['password' => 'password123', 'factor' => ['method' => 'totp', 'code' => Totp::code($this->secret, Totp::step(time()))]], $this->auth);
        $this->assertSame(429, $r['status']);
    }

    public function testSignInAndStepUpFailuresShareOneBudgetInParallel(): void
    {
        $this->user();
        $requests = [];
        for ($i = 0; $i < 3; ++$i) {
            $requests[] = $this->signIn($this->mfaToken(), 'totp', '000000');
        }
        for ($i = 0; $i < 4; ++$i) {
            $requests[] = $this->stepUp('totp', '000000');
        }
        $results = $this->parallel($requests);

        $codes = $this->codes($results);
        $this->assertSame(5, $codes['invalid_mfa_code'] ?? 0, json_encode($results));
        $this->assertSame(2, $codes['rate_limited'] ?? 0, json_encode($results));
    }

    public function testSameTotpForStepUpAndSignInHasOneWinner(): void
    {
        $this->user();
        $code = Totp::code($this->secret, Totp::step(time()));
        $results = $this->parallel([$this->stepUp('totp', $code), $this->signIn($this->mfaToken(), 'totp', $code)]);

        $statuses = array_column($results, 'status');
        $this->assertSame(1, count(array_filter($statuses, static fn (int $s): bool => 200 === $s)), json_encode($results));
        $this->assertSame(0, count(array_filter($statuses, static fn (int $s): bool => 0 === $s)), json_encode($results));
    }

    public function testSameBackupCodeInParallelStepUpsHasOneWinner(): void
    {
        $codes = $this->user();
        $results = $this->parallel([$this->stepUp('backup_code', $codes[0]), $this->stepUp('backup_code', $codes[0]), $this->stepUp('backup_code', $codes[0])]);

        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([200, 422, 422], $statuses, json_encode($results));
        $this->assertSame(9, (int) static::getContainer()->get(Connection::class)->fetchOne('SELECT COUNT(*) FROM mfa_backup_code WHERE used_at IS NULL'));
    }

    public function testWrongPasswordsAreCountedExactlyInParallel(): void
    {
        $this->user();
        $results = $this->parallel(array_fill(0, 14, ['/api/auth/step-up', ['password' => 'wrong'], $this->auth]));

        $codes = $this->codes($results);
        $this->assertSame(10, $codes['invalid_credentials'] ?? 0, json_encode($results));
        $this->assertSame(4, $codes['rate_limited'] ?? 0, json_encode($results));
    }
}
