<?php

declare(strict_types=1);

namespace App\Security;

use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Short-lived, purpose-bound HMAC tokens for the cookie-less API (WebAuthn challenges, OAuth state).
 *
 * The key is derived per purpose from APP_SECRET, so a token issued for one purpose never verifies
 * for another. Expiry is checked against the injected clock.
 */
final readonly class SignedTokenService
{
    public function __construct(
        #[Autowire(env: 'APP_SECRET')]
        private string $secret,
        private ClockInterface $clock,
    ) {
    }

    /**
     * @param array<string, scalar|null> $claims
     */
    public function issue(string $purpose, array $claims, int $ttlSeconds): string
    {
        $payload = $claims + ['p' => $purpose, 'exp' => $this->clock->now()->getTimestamp() + $ttlSeconds];
        $body = self::b64(json_encode($payload, \JSON_THROW_ON_ERROR));

        return $body.'.'.self::b64($this->sign($purpose, $body));
    }

    /**
     * @return array<string, mixed>|null the claims, or null if the token is malformed, forged, expired or for another purpose
     */
    public function verify(string $purpose, string $token): ?array
    {
        $parts = explode('.', $token);
        if (2 !== count($parts)) {
            return null;
        }
        [$body, $sig] = $parts;
        if (!hash_equals(self::b64($this->sign($purpose, $body)), $sig)) {
            return null;
        }
        $json = base64_decode(strtr($body, '-_', '+/'), true);
        $payload = false === $json ? null : json_decode($json, true);
        if (!is_array($payload) || ($payload['p'] ?? null) !== $purpose) {
            return null;
        }
        if (!is_int($payload['exp'] ?? null) || $payload['exp'] < $this->clock->now()->getTimestamp()) {
            return null;
        }

        return $payload;
    }

    public function now(): \DateTimeImmutable
    {
        return $this->clock->now();
    }

    private function sign(string $purpose, string $body): string
    {
        $key = hash_hmac('sha256', 'signed-token:'.$purpose, $this->secret, true);

        return hash_hmac('sha256', $body, $key, true);
    }

    public static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
