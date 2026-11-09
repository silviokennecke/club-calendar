<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\Ke1;
use App\Opaque\OpaqueServer;
use App\Opaque\Oprf;
use App\Opaque\RegistrationRecord;
use PHPUnit\Framework\TestCase;

/** Replays what is deterministic in the @serenity-kit/opaque 1.1.0 transcripts. */
final class OpaqueServerSerenityTest extends TestCase
{
    /** @var array<string, mixed> */
    private array $data;

    protected function setUp(): void
    {
        $this->data = json_decode((string) file_get_contents(__DIR__.'/fixtures/serenity-transcripts.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    private static function b64(string $s): string
    {
        return (string) base64_decode(strtr($s, '-_', '+/'), true);
    }

    private function server(): OpaqueServer
    {
        $setup = self::b64($this->data['setup']['serverSetup']);
        self::assertSame(128, strlen($setup));
        self::assertSame(bin2hex(substr($setup, 0, 64)), $this->data['setup']['oprfSeedHex']);
        self::assertSame(bin2hex(substr($setup, 64, 32)), $this->data['setup']['serverPrivateKeyHex']);
        self::assertSame(bin2hex(substr($setup, 96, 32)), $this->data['setup']['dummyPublicKeyHex']);

        return new OpaqueServer(substr($setup, 64, 32), substr($setup, 0, 64));
    }

    public function testRegistrationResponsesAndRecords(): void
    {
        $server = $this->server();
        self::assertSame($this->data['setup']['serverPublicKeyHex'], bin2hex($server->serverPublicKey()));
        foreach ($this->data['transcripts'] as $t) {
            $reg = $t['registration'];
            self::assertSame(
                self::b64($reg['registrationResponse']),
                $server->createRegistrationResponse(self::b64($reg['registrationRequest']), $t['userIdentifier']),
            );
            $record = RegistrationRecord::fromBytes(self::b64($reg['registrationRecord']));
            self::assertSame(self::b64($reg['registrationRecord']), $record->toBytes());
        }
    }

    public function testLoginMessagesParseAndEvaluatedElementMatches(): void
    {
        $server = $this->server();
        $seed = (string) hex2bin($this->data['setup']['oprfSeedHex']);
        self::assertSame(64, strlen($seed));
        foreach ($this->data['transcripts'] as $t) {
            $record = RegistrationRecord::fromBytes(self::b64($t['registration']['registrationRecord']));
            foreach (['loginOk', 'loginWrongPassword'] as $kind) {
                $login = $t[$kind];
                $ke1 = self::b64($login['startLoginRequest']);
                $ke2 = self::b64($login['loginResponse']);
                self::assertSame(320, strlen($ke2));
                $parsed = Ke1::fromBytes($ke1);
                $key = OpaqueServer::deriveOprfKey($seed, $t['userIdentifier']);
                self::assertSame(substr($ke2, 0, 32), Oprf::blindEvaluate($key, $parsed->blindedElement));

                // the masked response opens with the record's masking key to server_public_key || envelope
                $pad = \App\Opaque\Hkdf::expand($record->maskingKey, substr($ke2, 32, 32).'CredentialResponsePad', 128);
                self::assertSame($server->serverPublicKey().$record->envelope, substr($ke2, 64, 128) ^ $pad);

                // our own KE2 for the same KE1 has the same shape and evaluated element
                $mine = $server->generateKE2($ke1, $record, $t['userIdentifier'], $t['identifiers']['client'] ?? null);
                self::assertSame(320, strlen($mine->ke2));
                self::assertSame(substr($ke2, 0, 32), substr($mine->ke2, 0, 32));
            }
        }
    }

    public function testUnknownUserEvaluatedElement(): void
    {
        $u = $this->data['unknownUser'];
        $seed = (string) hex2bin($this->data['setup']['oprfSeedHex']);
        $ke1 = self::b64($u['startLoginRequest']);
        $ke2 = self::b64($u['loginResponse']);
        $key = OpaqueServer::deriveOprfKey($seed, $u['userIdentifier']);
        self::assertSame(substr($ke2, 0, 32), Oprf::blindEvaluate($key, Ke1::fromBytes($ke1)->blindedElement));
        $mine = $this->server()->generateFakeKE2($ke1, $u['userIdentifier']);
        self::assertSame(substr($ke2, 0, 32), substr($mine->ke2, 0, 32));
    }
}
