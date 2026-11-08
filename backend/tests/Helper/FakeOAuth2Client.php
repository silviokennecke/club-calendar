<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use App\OAuth\OidcProvider;
use App\OAuth\OidcResourceOwner;
use KnpU\OAuth2ClientBundle\Client\OAuth2ClientInterface;
use League\OAuth2\Client\Token\AccessToken;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * Stands in for a knpu OAuth2 client: redirect() goes to a fake authorize URL carrying the given
 * options, fetchUser() returns the configured claims (as the OIDC provider would after the code exchange).
 * The ID token nonce is simulated: by default the provider echoes the nonce of the last redirect;
 * `$tokenNonce` replaces it and `$omitNonce` leaves it out. fetchUser() fails like OidcProvider on a mismatch.
 */
final class FakeOAuth2Client implements OAuth2ClientInterface
{
    /** @var array<string, mixed> */
    public array $claims = [];
    public int $fetchUserCalls = 0;
    public ?string $lastNonce = null;
    public ?string $tokenNonce = null;
    public bool $omitNonce = false;
    private ?OidcProvider $provider = null;

    public function setAsStateless(): void
    {
    }

    public function redirect(array $scopes, array $options)
    {
        $this->lastNonce = $options['nonce'] ?? null;

        return new RedirectResponse('https://provider.example/authorize?'.http_build_query($options));
    }

    public function getAccessToken(array $options = [])
    {
        return new AccessToken(['access_token' => 'fake']);
    }

    public function fetchUserFromToken(AccessToken $accessToken)
    {
        return $this->fetchUser();
    }

    public function fetchUser()
    {
        ++$this->fetchUserCalls;
        $sent = $this->omitNonce ? null : ($this->tokenNonce ?? $this->lastNonce);
        $expected = $this->provider instanceof FakeOidcProvider ? $this->provider->expected : null;
        if (null === $expected || !is_string($sent) || !hash_equals($expected, $sent)) {
            throw new \UnexpectedValueException('ID token nonce mismatch');
        }

        return new OidcResourceOwner($this->claims);
    }

    public function getOAuth2Provider(): OidcProvider
    {
        return $this->provider ??= new FakeOidcProvider(['issuer' => 'https://provider.example', 'clientId' => 'c', 'clientSecret' => 's']);
    }
}

final class FakeOidcProvider extends OidcProvider
{
    public ?string $expected = null;

    public function expectNonce(string $nonce): void
    {
        $this->expected = $nonce;
    }
}
