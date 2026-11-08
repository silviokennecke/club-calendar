<?php

declare(strict_types=1);

namespace App\Tests\Helper;

/** Locally generated RSA key for signing ID tokens in tests; the matching JWKS is served by a mocked HTTP client. */
final class TestJwks
{
    public const string KID = 'test-key-1';

    private static ?\OpenSSLAsymmetricKey $key = null;

    public static function b64(string $s): string
    {
        return rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    }

    public static function generate(): \OpenSSLAsymmetricKey
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        if (false === $key) {
            throw new \RuntimeException('Cannot generate RSA key');
        }

        return $key;
    }

    public static function key(): \OpenSSLAsymmetricKey
    {
        return self::$key ??= self::generate();
    }

    /** @return array<string, mixed> */
    public static function jwk(?\OpenSSLAsymmetricKey $key = null, string $kid = self::KID): array
    {
        $rsa = openssl_pkey_get_details($key ?? self::key())['rsa'];

        return ['kty' => 'RSA', 'kid' => $kid, 'use' => 'sig', 'alg' => 'RS256', 'n' => self::b64($rsa['n']), 'e' => self::b64($rsa['e'])];
    }

    /** @return array{keys: list<array<string, mixed>>} */
    public static function document(?\OpenSSLAsymmetricKey $key = null, string $kid = self::KID): array
    {
        return ['keys' => [self::jwk($key, $kid)]];
    }

    /**
     * @param array<string, mixed> $claims
     * @param array<string, mixed> $header
     */
    public static function sign(array $claims, ?\OpenSSLAsymmetricKey $key = null, array $header = []): string
    {
        $header += ['alg' => 'RS256', 'typ' => 'JWT', 'kid' => self::KID];
        $input = self::b64(json_encode($header, JSON_THROW_ON_ERROR)).'.'.self::b64(json_encode($claims, JSON_THROW_ON_ERROR));
        openssl_sign($input, $sig, $key ?? self::key(), OPENSSL_ALGO_SHA256);

        return $input.'.'.self::b64($sig);
    }
}
