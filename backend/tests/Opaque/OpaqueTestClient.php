<?php

declare(strict_types=1);

namespace App\Tests\Opaque;

use App\Opaque\Bytes;
use App\Opaque\Hkdf;
use App\Opaque\KeySchedule;
use App\Opaque\Mac;
use App\Opaque\Oprf;
use App\Opaque\Ristretto;

/** Test-only OPAQUE-3DH client (RFC 9807 §5-§6), Identity key stretching, internal envelope mode. */
final class OpaqueTestClient
{
    private const string KEYPAIR_INFO = 'OPAQUE-DeriveDiffieHellmanKeyPair';

    public function __construct(
        private readonly string $context = '',
        private readonly ?string $clientIdentity = null,
        private readonly ?string $serverIdentity = null,
    ) {
    }

    /** @return array{request: string, blind: string} */
    public function startRegistration(string $password, ?string $blind = null): array
    {
        $blind ??= sodium_crypto_core_ristretto255_scalar_random();

        return ['request' => OprfTestClient::blind($password, $blind), 'blind' => $blind];
    }

    /** @return array{record: string, exportKey: string, serverPublicKey: string} */
    public function finishRegistration(string $password, string $blind, string $response, ?string $envelopeNonce = null): array
    {
        $evaluated = substr($response, 0, 32);
        $serverPublicKey = substr($response, 32, 32);
        $rpwd = $this->randomizedPassword($password, $blind, $evaluated);
        $nonce = $envelopeNonce ?? random_bytes(32);

        $maskingKey = Hkdf::expand($rpwd, 'MaskingKey', 64);
        $authKey = Hkdf::expand($rpwd, $nonce.'AuthKey', 64);
        $exportKey = Hkdf::expand($rpwd, $nonce.'ExportKey', 64);
        [, $clientPk] = Oprf::deriveKeyPair(Hkdf::expand($rpwd, $nonce.'PrivateKey', 32), self::KEYPAIR_INFO);
        $authTag = Mac::compute($authKey, $nonce.$this->cleartext($serverPublicKey, $clientPk));

        return ['record' => $clientPk.$maskingKey.$nonce.$authTag, 'exportKey' => $exportKey, 'serverPublicKey' => $serverPublicKey];
    }

    /** @return array{ke1: string, blind: string, esk: string} */
    public function startLogin(string $password, ?string $blind = null, ?string $clientNonce = null, ?string $keyshareSeed = null): array
    {
        $blind ??= sodium_crypto_core_ristretto255_scalar_random();
        [$esk, $epk] = Oprf::deriveKeyPair($keyshareSeed ?? random_bytes(32), self::KEYPAIR_INFO);

        return ['ke1' => OprfTestClient::blind($password, $blind).($clientNonce ?? random_bytes(32)).$epk, 'blind' => $blind, 'esk' => $esk];
    }

    /**
     * @param array{ke1: string, blind: string, esk: string} $login
     *
     * @return array{ke3: string, sessionKey: string, exportKey: string}|null null on any verification failure
     */
    public function finishLogin(string $password, array $login, string $ke2, ?string $pinnedServerPublicKey = null): ?array
    {
        if (320 !== strlen($ke2)) {
            return null;
        }
        $evaluated = substr($ke2, 0, 32);
        $maskingNonce = substr($ke2, 32, 32);
        $masked = substr($ke2, 64, 128);
        $serverNonce = substr($ke2, 192, 32);
        $serverEpk = substr($ke2, 224, 32);
        $serverMac = substr($ke2, 256, 64);

        try {
            Ristretto::assertElement($evaluated);
            Ristretto::assertElement($serverEpk);
            $rpwd = $this->randomizedPassword($password, $login['blind'], $evaluated);
        } catch (\Throwable) {
            return null;
        }
        $maskingKey = Hkdf::expand($rpwd, 'MaskingKey', 64);
        $unmasked = Bytes::xor(Hkdf::expand($maskingKey, $maskingNonce.'CredentialResponsePad', 128), $masked);
        $serverPk = substr($unmasked, 0, 32);
        $nonce = substr($unmasked, 32, 32);
        $authTag = substr($unmasked, 64, 64);
        if (!sodium_crypto_core_ristretto255_is_valid_point($serverPk) || (null !== $pinnedServerPublicKey && $pinnedServerPublicKey !== $serverPk)) {
            return null;
        }

        $authKey = Hkdf::expand($rpwd, $nonce.'AuthKey', 64);
        [$clientSk, $clientPk] = Oprf::deriveKeyPair(Hkdf::expand($rpwd, $nonce.'PrivateKey', 32), self::KEYPAIR_INFO);
        if (!Mac::verify($authKey, $nonce.$this->cleartext($serverPk, $clientPk), $authTag)) {
            return null;
        }
        $exportKey = Hkdf::expand($rpwd, $nonce.'ExportKey', 64);

        $ikm = Ristretto::mult($login['esk'], $serverEpk).Ristretto::mult($login['esk'], $serverPk).Ristretto::mult($clientSk, $serverEpk);
        $preamble = KeySchedule::preamble(
            $this->context,
            $this->clientIdentity ?? $clientPk,
            $login['ke1'],
            $this->serverIdentity ?? $serverPk,
            $evaluated.$maskingNonce.$masked,
            $serverNonce,
            $serverEpk,
        );
        $keys = KeySchedule::deriveKeys($ikm, $preamble);
        if (!hash_equals(KeySchedule::serverMac($keys), $serverMac)) {
            return null;
        }

        return ['ke3' => KeySchedule::clientMac($keys, $preamble, $serverMac), 'sessionKey' => $keys->sessionKey, 'exportKey' => $exportKey];
    }

    private function randomizedPassword(string $password, string $blind, string $evaluated): string
    {
        $y = OprfTestClient::finalize($password, $blind, $evaluated);

        // Identity KSF: stretched == y
        return Hkdf::extract('', $y.$y);
    }

    private function cleartext(string $serverPk, string $clientPk): string
    {
        $server = $this->serverIdentity ?? $serverPk;
        $client = $this->clientIdentity ?? $clientPk;

        return $serverPk.Bytes::i2osp(strlen($server), 2).$server.Bytes::i2osp(strlen($client), 2).$client;
    }
}
