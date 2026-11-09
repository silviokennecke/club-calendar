<?php

declare(strict_types=1);

namespace App\Service;

/**
 * Evidence that the person holds a feed address (and the secret of a PRIVATE feed). The SSO state carries only the
 * SHA-256 of the secret (`secretSha256`), so the secret never reaches the provider.
 */
final readonly class FeedProof
{
    public function __construct(
        public string $feedId,
        public ?string $secret = null,
        public ?string $secretSha256 = null,
    ) {
    }

    /** Lenient: anything malformed is no proof at all, so a bad proof behaves exactly like none. */
    public static function fromInput(mixed $input): ?self
    {
        if (!is_array($input) || !is_string($input['feedId'] ?? null) || '' === $input['feedId'] || strlen($input['feedId']) > 64) {
            return null;
        }
        $secret = $input['secret'] ?? null;
        if (!is_string($secret) || '' === $secret || strlen($secret) > 256) {
            $secret = null;
        }

        return new self($input['feedId'], $secret);
    }
}
