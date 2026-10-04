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
