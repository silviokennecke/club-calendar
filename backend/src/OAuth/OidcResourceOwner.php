<?php

declare(strict_types=1);

namespace App\OAuth;

use League\OAuth2\Client\Provider\ResourceOwnerInterface;

class OidcResourceOwner implements ResourceOwnerInterface
{
    public function __construct(private readonly array $data)
    {
    }

    public function getId(): string
    {
        return (string) ($this->data['sub'] ?? $this->data['id'] ?? '');
    }

    /** Microsoft tenant id ("tid"); null when absent or not a UUID. */
    public function getTenantId(): ?string
    {
        return $this->uuidClaim('tid');
    }

    /** Microsoft object id ("oid"); null when absent or not a UUID. */
    public function getObjectId(): ?string
    {
        return $this->uuidClaim('oid');
    }

    private function uuidClaim(string $name): ?string
    {
        $value = $this->data[$name] ?? null;

        return is_string($value) && 1 === preg_match('/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i', $value) ? strtolower($value) : null;
    }

    public function getEmail(): ?string
    {
        return isset($this->data['email']) ? (string) $this->data['email'] : null;
    }

    /**
     * The provider's own "email_verified" claim (Google: boolean, Apple: "true"/"false" string).
     * Whether the claim is trusted at all is decided per provider in AuthService.
     */
    public function isEmailVerified(): bool
    {
        $value = $this->data['email_verified'] ?? null;

        return true === $value || 'true' === $value;
    }

    public function getName(): ?string
    {
        return isset($this->data['name']) ? (string) $this->data['name'] : null;
    }

    public function toArray(): array
    {
        return $this->data;
    }
}
