<?php

declare(strict_types=1);

namespace App\Tests\Helper;

/**
 * A minimal WebAuthn authenticator in software (ES256, "none" attestation) for tests.
 *
 * The key pair is generated at runtime, so no key material is checked in. Every part of the ceremony
 * (authenticatorData, clientDataJSON, signature) can be overridden to build broken responses.
 */
final class SoftwareAuthenticator
{
    public const int FLAG_UP = 0x01;
    public const int FLAG_UV = 0x04;
    public const int FLAG_AT = 0x40;

    public readonly string $credentialId;
    private \OpenSSLAsymmetricKey $key;
    public int $signCount = 0;

    public function __construct(?string $credentialId = null)
    {
        $key = openssl_pkey_new(['private_key_type' => \OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        if (false === $key) {
            throw new \RuntimeException('Could not create an EC key pair');
        }
        $this->key = $key;
        $this->credentialId = $credentialId ?? random_bytes(16);
    }

    public static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    /** COSE_Key (EC2, P-256, ES256) of the public key. */
    public function cosePublicKey(): string
    {
        $details = openssl_pkey_get_details($this->key);
        $x = str_pad($details['ec']['x'], 32, "\0", \STR_PAD_LEFT);
        $y = str_pad($details['ec']['y'], 32, "\0", \STR_PAD_LEFT);

        // {1: 2, 3: -7, -1: 1, -2: x, -3: y}
        return "\xA5\x01\x02\x03\x26\x20\x01\x21".self::cborBytes($x)."\x22".self::cborBytes($y);
    }

    /**
     * Response JSON of navigator.credentials.create() as @simplewebauthn/browser sends it.
     *
     * @param array{origin?: string, rpId?: string, type?: string, challenge?: string, flags?: int, cose?: string,
     *              attStmt?: callable(string, string): array{0: string, 1: string}} $o
     */
    public function attestation(string $challengeB64, string $origin, string $rpId, array $o = []): array
    {
        $flags = $o['flags'] ?? (self::FLAG_UP | self::FLAG_UV | self::FLAG_AT);
        $attested = str_repeat("\0", 16).pack('n', strlen($this->credentialId)).$this->credentialId.($o['cose'] ?? $this->cosePublicKey());
        $authData = hash('sha256', $o['rpId'] ?? $rpId, true).chr($flags).pack('N', $this->signCount).$attested;
        $clientData = $this->clientData($o['type'] ?? 'webauthn.create', $o['challenge'] ?? $challengeB64, $o['origin'] ?? $origin);
        // attStmt: callable(authData, clientDataHash): array{0: fmt, 1: CBOR map of the statement}
        [$fmt, $attStmt] = isset($o['attStmt']) ? ($o['attStmt'])($authData, hash('sha256', $clientData, true)) : ['none', "\xA0"];
        $attestationObject = "\xA3"
            .self::cborText('fmt').self::cborText($fmt)
            .self::cborText('attStmt').$attStmt
            .self::cborText('authData').self::cborBytes($authData);

        return [
            'id' => self::b64($this->credentialId),
            'rawId' => self::b64($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => self::b64($clientData),
                'attestationObject' => self::b64($attestationObject),
                'transports' => ['internal'],
            ],
            'clientExtensionResults' => new \stdClass(),
            'authenticatorAttachment' => 'platform',
        ];
    }

    /**
     * Response JSON of navigator.credentials.get().
     *
     * @param array{origin?: string, rpId?: string, type?: string, challenge?: string, flags?: int,
     *              userHandle?: string, signCount?: int, tamper?: callable(string): string, signWith?: self} $o
     */
    public function assertion(string $challengeB64, string $origin, string $rpId, string $userHandle, array $o = []): array
    {
        $count = $o['signCount'] ?? ++$this->signCount;
        $flags = $o['flags'] ?? (self::FLAG_UP | self::FLAG_UV);
        $authData = hash('sha256', $o['rpId'] ?? $rpId, true).chr($flags).pack('N', $count);
        $clientData = $this->clientData($o['type'] ?? 'webauthn.get', $o['challenge'] ?? $challengeB64, $o['origin'] ?? $origin);
        $signer = $o['signWith'] ?? $this;
        $signature = $signer->sign($authData.hash('sha256', $clientData, true));
        if (isset($o['tamper'])) {
            $authData = ($o['tamper'])($authData);
        }

        return [
            'id' => self::b64($this->credentialId),
            'rawId' => self::b64($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => self::b64($clientData),
                'authenticatorData' => self::b64($authData),
                'signature' => self::b64($signature),
                'userHandle' => self::b64($o['userHandle'] ?? $userHandle),
            ],
            'clientExtensionResults' => new \stdClass(),
            'authenticatorAttachment' => 'platform',
        ];
    }

    public function sign(string $data): string
    {
        openssl_sign($data, $signature, $this->key, \OPENSSL_ALGO_SHA256);

        return $signature;
    }

    private function clientData(string $type, string $challenge, string $origin): string
    {
        return json_encode(['type' => $type, 'challenge' => $challenge, 'origin' => $origin, 'crossOrigin' => false], \JSON_UNESCAPED_SLASHES);
    }

    public static function cborText(string $s): string
    {
        return chr(0x60 + strlen($s)).$s;
    }

    public static function cborBytes(string $b): string
    {
        $len = strlen($b);

        return match (true) {
            $len < 24 => chr(0x40 + $len),
            $len < 256 => "\x58".chr($len),
            default => "\x59".pack('n', $len),
        }.$b;
    }
}
