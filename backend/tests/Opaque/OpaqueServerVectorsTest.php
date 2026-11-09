<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\Hkdf;
use App\Opaque\Ke1;
use App\Opaque\OpaqueServer;
use App\Opaque\Oprf;
use App\Opaque\RegistrationRecord;
use App\Opaque\ServerLoginState;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class OpaqueServerVectorsTest extends TestCase
{
    /** @return array<string, mixed> */
    private static function vector(string $id): array
    {
        $d = json_decode((string) file_get_contents(__DIR__.'/fixtures/rfc9807-vectors.json'), true, flags: JSON_THROW_ON_ERROR);
        foreach ($d['vectors'] as $v) {
            if ($v['id'] === $id) {
                return $v;
            }
        }
        self::fail("Vector $id missing");
    }

    private static function h(array $section, string $key): string
    {
        return (string) hex2bin($section[$key]);
    }

    /** @return array<string, array{string}> */
    public static function fullVectors(): array
    {
        return ['C.1.1' => ['C.1.1'], 'C.1.2' => ['C.1.2']];
    }

    /** @return array<string, array{string}> */
    public static function oprfOnlyVectors(): array
    {
        return ['C.1.3' => ['C.1.3'], 'C.1.4' => ['C.1.4']];
    }

    private static function server(array $in): OpaqueServer
    {
        return new OpaqueServer(
            self::h($in, 'server_private_key'),
            self::h($in, 'oprf_seed'),
            self::h(self::vector('C.1.1')['config'], 'Context'),
            isset($in['server_identity']) ? self::h($in, 'server_identity') : null,
            new QueueRandom([self::h($in, 'masking_nonce'), self::h($in, 'server_nonce'), self::h($in, 'server_keyshare_seed')]),
        );
    }

    #[DataProvider('fullVectors')]
    public function testRegistrationAndLoginAgainstRfcVector(string $id): void
    {
        $v = self::vector($id);
        $this->assertTrue($v['matchesOurSuite']);
        $in = $v['inputs'];
        $out = $v['outputs'];
        $cred = self::h($in, 'credential_identifier');

        self::assertSame(
            $v['intermediate']['oprf_key'],
            bin2hex(OpaqueServer::deriveOprfKey(self::h($in, 'oprf_seed'), $cred)),
        );

        $server = self::server($in);
        self::assertSame($in['server_public_key'], bin2hex($server->serverPublicKey()));
        self::assertSame($out['registration_response'], bin2hex($server->createRegistrationResponse(self::h($out, 'registration_request'), $cred)));

        $record = RegistrationRecord::fromBytes(self::h($out, 'registration_upload'));
        self::assertSame($v['intermediate']['client_public_key'], bin2hex($record->clientPublicKey));
        self::assertSame($v['intermediate']['envelope'], bin2hex($record->envelope));
        self::assertSame($out['registration_upload'], bin2hex($record->toBytes()));

        $clientIdentity = isset($in['client_identity']) ? self::h($in, 'client_identity') : null;
        $start = $server->generateKE2(self::h($out, 'KE1'), $record, $cred, $clientIdentity);
        self::assertSame($out['KE2'], bin2hex($start->ke2));
        self::assertSame(self::h($out, 'session_key'), $start->state->sessionKey());

        self::assertSame(self::h($out, 'session_key'), $server->serverFinish($start->state, self::h($out, 'KE3')));

        // state survives sealing
        $restored = ServerLoginState::fromBytes($start->state->toBytes());
        self::assertSame(self::h($out, 'session_key'), $server->serverFinish($restored, self::h($out, 'KE3')));
    }

    #[DataProvider('fullVectors')]
    public function testKeyScheduleIntermediates(string $id): void
    {
        $v = self::vector($id);
        $in = $v['inputs'];
        $out = $v['outputs'];
        $server = self::server($in);
        $record = RegistrationRecord::fromBytes(self::h($out, 'registration_upload'));
        $start = $server->generateKE2(self::h($out, 'KE1'), $record, self::h($in, 'credential_identifier'), isset($in['client_identity']) ? self::h($in, 'client_identity') : null);
        // KE2 server_mac was already compared byte for byte; the expected client MAC equals the vector's KE3
        self::assertSame($out['KE3'], bin2hex(substr($start->state->toBytes(), 64)));
    }

    #[DataProvider('oprfOnlyVectors')]
    public function testOprfPartOfCurve25519KeVectors(string $id): void
    {
        $v = self::vector($id);
        $this->assertFalse($v['matchesOurSuite']);
        $in = $v['inputs'];
        $out = $v['outputs'];
        $key = OpaqueServer::deriveOprfKey(self::h($in, 'oprf_seed'), self::h($in, 'credential_identifier'));
        self::assertSame($v['intermediate']['oprf_key'], bin2hex($key));
        $evaluated = Oprf::blindEvaluate($key, self::h($out, 'registration_request'));
        self::assertSame(substr($out['registration_response'], 0, 64), bin2hex($evaluated));
        // the evaluated element of KE2 uses the same key
        $ke1 = self::h($out, 'KE1');
        self::assertSame(substr($out['KE2'], 0, 64), bin2hex(Oprf::blindEvaluate($key, substr($ke1, 0, 32))));
    }

    public function testFakeRecordVectorC21(): void
    {
        $v = self::vector('C.2.1');
        $this->assertTrue($v['matchesOurSuite']);
        $in = $v['inputs'];
        $server = self::server($in);
        $record = RegistrationRecord::fake(self::h($in, 'client_public_key'), self::h($in, 'masking_key'));
        $start = $server->generateKE2(self::h($in, 'KE1'), $record, self::h($in, 'credential_identifier'), self::h($in, 'client_identity'));
        self::assertSame($v['outputs']['KE2'], bin2hex($start->ke2));
    }

    public function testOprfPartOfFakeCurve25519Vector(): void
    {
        $v = self::vector('C.2.2');
        $in = $v['inputs'];
        $key = OpaqueServer::deriveOprfKey(self::h($in, 'oprf_seed'), self::h($in, 'credential_identifier'));
        $ke1 = self::h($in, 'KE1');
        self::assertSame(substr($v['outputs']['KE2'], 0, 64), bin2hex(Oprf::blindEvaluate($key, substr($ke1, 0, 32))));
        self::assertSame(self::h($in, 'masking_nonce'), substr((string) hex2bin($v['outputs']['KE2']), 32, 32));
    }

    public function testKe1ParsesVectors(): void
    {
        $ke1 = Ke1::fromBytes(self::h(self::vector('C.1.1')['outputs'], 'KE1'));
        self::assertSame(32, strlen($ke1->blindedElement));
    }

    public function testHkdfMatchesPhpBuiltin(): void
    {
        $ikm = random_bytes(40);
        $prk = Hkdf::extract('', $ikm);
        self::assertSame(hash_hkdf('sha512', $ikm, 200, 'info'), Hkdf::expand($prk, 'info', 200));
    }
}
