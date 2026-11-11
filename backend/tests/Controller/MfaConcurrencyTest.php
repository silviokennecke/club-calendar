<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Entity\User;
use App\Entity\UserTotp;
use App\Security\Mfa\Totp;
use App\Service\MfaService;
use App\Service\TokenService;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\SoftwareAuthenticator;
use App\Tests\Helper\TestHelper;
use Doctrine\DBAL\Connection;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Races at the second step of the sign-in. Requests run in real parallel processes (pcntl_fork): every child
 * boots its own kernel and database connection and waits for a common start time before it sends its request.
 */
class MfaConcurrencyTest extends WebTestCase
{
    private const string RP_ID = 'localhost';

    private string $secret;
    private KernelBrowser $client;

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

    /** @return array{0: User, 1: list<string>} */
    private function user(): array
    {
        $c = static::getContainer();
        $em = $c->get(EntityManagerInterface::class);
        $user = TestHelper::createUser($em, $c->get(UserPasswordHasherInterface::class), 'alice@example.com', 'password123', true);
        $em->persist(new UserTotp($user, $this->secret));
        $user->setMfaEnforced(true);
        $em->flush();

        return [$user, $c->get(MfaService::class)->regenerateBackupCodes($user)];
    }

    private function mfaToken(): string
    {
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/login', ['email' => 'alice@example.com', 'password' => 'password123']);
        $this->assertTrue($r['body']['mfaRequired'] ?? false, $r['content']);

        return $r['body']['mfaToken'];
    }

    /**
     * @param list<array{0: string, 1: array<string, mixed>}> $requests POST path and body, one child each
     *
     * @return list<array{status: int, body: array<string, mixed>}> in request order
     */
    private function parallel(array $requests): array
    {
        $dir = dirname(__DIR__, 2).'/var';
        $startAt = microtime(true) + 3.0;
        $files = $pids = [];
        // No open connection or booted kernel may be shared with the children.
        static::getContainer()->get(Connection::class)->close();
        self::ensureKernelShutdown();
        foreach ($requests as $i => [$path, $body]) {
            $files[$i] = tempnam($dir, 'mfa-race-');
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
                    $r = TestHelper::jsonRequest($client, 'POST', $path, $body);
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

    private function db(): Connection
    {
        return static::getContainer()->get(Connection::class);
    }

    private function verify(string $token, string $method, string $code): array
    {
        return ['/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => $method, 'code' => $code]];
    }

    /** @param list<array{status: int, body: array<string, mixed>}> $results */
    private function statuses(array $results): array
    {
        $s = array_column($results, 'status');
        sort($s);

        return $s;
    }

    public function testSameTotpTwiceInParallelIssuesOneSession(): void
    {
        $this->user();
        $token = $this->mfaToken();
        $code = Totp::code($this->secret, Totp::step(time()));
        $results = $this->parallel([$this->verify($token, 'totp', $code), $this->verify($token, 'totp', $code), $this->verify($token, 'totp', $code)]);

        $this->assertSame([200, 401, 401], $this->statuses($results), json_encode($results));
        $this->assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(DISTINCT family_id) FROM refresh_token'));
    }

    public function testTotpAndBackupCodeWithOneTokenIssueOneSessionAndLoserBurnsNothing(): void
    {
        [, $codes] = $this->user();
        $token = $this->mfaToken();
        $results = $this->parallel([
            $this->verify($token, 'totp', Totp::code($this->secret, Totp::step(time()))),
            $this->verify($token, 'backup_code', $codes[0]),
        ]);

        $this->assertSame([200, 401], $this->statuses($results), json_encode($results));
        $this->assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(DISTINCT family_id) FROM refresh_token'));
        if (isset($results[1]['body']['mfaDisabled'])) {
            $this->assertFalse((bool) $this->db()->fetchOne('SELECT mfa_enforced FROM user'));
        } else {
            // TOTP won: the backup code was not spent by the lost race
            $this->assertSame(10, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM mfa_backup_code WHERE used_at IS NULL'));
            $this->assertTrue((bool) $this->db()->fetchOne('SELECT mfa_enforced FROM user'));
        }
    }

    public function testTwoBackupCodesInParallelOneSessionSurvives(): void
    {
        [$user, $codes] = $this->user();
        $token = $this->mfaToken();
        $versionBefore = (int) $this->db()->fetchOne('SELECT token_version FROM user');
        $results = $this->parallel([$this->verify($token, 'backup_code', $codes[0]), $this->verify($token, 'backup_code', $codes[1])]);

        $this->assertSame([200, 401], $this->statuses($results), json_encode($results));
        $winner = 200 === $results[0]['status'] ? $results[0] : $results[1];
        $this->assertTrue($winner['body']['mfaDisabled']);
        $this->assertSame($versionBefore + 1, (int) $this->db()->fetchOne('SELECT token_version FROM user'));
        $this->assertSame(0, (int) $this->db()->fetchOne('SELECT COUNT(*) FROM mfa_backup_code'));
        $this->assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(DISTINCT family_id) FROM refresh_token'));
        // The surviving session carries the new token version
        $me = TestHelper::jsonRequest($this->client, 'GET', '/api/auth/me', [], 'Bearer '.$winner['body']['access_token']);
        $this->assertSame(200, $me['status'], $me['content']);
    }

    public function testGuessBudgetOfATokenHoldsUnderParallelRequests(): void
    {
        $this->user();
        $token = $this->mfaToken();
        $results = $this->parallel(array_fill(0, 9, $this->verify($token, 'totp', '000000')));

        $codes = array_count_values(array_column(array_column($results, 'body'), 'code'));
        $this->assertSame(5, $codes['invalid_mfa_code'] ?? 0, json_encode($results));
        $this->assertSame(4, $codes['rate_limited'] ?? 0, json_encode($results));
        // Even the right code is refused once the budget is gone
        $r = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/mfa/verify', ['mfaToken' => $token, 'method' => 'totp', 'code' => Totp::code($this->secret, Totp::step(time()))]);
        $this->assertSame(429, $r['status']);
    }

    public function testSamePasskeyAssertionTwiceInParallelIssuesOneSession(): void
    {
        [$user] = $this->user();
        $origin = rtrim((string) $_ENV['FRONTEND_URL'], '/');
        $auth = 'Bearer '.static::getContainer()->get(TokenService::class)->createAccessToken($user);
        $o = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/options', ['password' => 'password123'], $auth);
        $key = new SoftwareAuthenticator();
        $reg = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/webauthn/register/verify', [
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $key->attestation($o['body']['options']['challenge'], $origin, self::RP_ID),
            'deviceName' => 'Software',
        ], $auth);
        $this->assertSame(200, $reg['status'], $reg['content']);

        $token = $this->mfaToken();
        $o = TestHelper::jsonRequest($this->client, 'POST', '/api/auth/mfa/passkey/options', ['mfaToken' => $token]);
        $body = [
            'mfaToken' => $token,
            'challengeToken' => $o['body']['challengeToken'],
            'response' => $key->assertion($o['body']['options']['challenge'], $origin, self::RP_ID, $user->getId()),
        ];
        $results = $this->parallel([['/api/auth/mfa/passkey/verify', $body], ['/api/auth/mfa/passkey/verify', $body]]);

        $this->assertSame([200, 401], $this->statuses($results), json_encode($results));
        $this->assertSame(1, (int) $this->db()->fetchOne('SELECT COUNT(DISTINCT family_id) FROM refresh_token'));
    }
}
