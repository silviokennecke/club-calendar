<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use App\OAuth\OidcResourceOwner;
use KnpU\OAuth2ClientBundle\Client\OAuth2ClientInterface;
use League\OAuth2\Client\Token\AccessToken;
use Symfony\Component\HttpFoundation\RedirectResponse;

/**
 * Stands in for a knpu OAuth2 client: redirect() goes to a fake authorize URL carrying the given
 * options, fetchUser() returns the configured claims (as the OIDC provider would after the code exchange).
 */
final class FakeOAuth2Client implements OAuth2ClientInterface
{
    /** @var array<string, mixed> */
    public array $claims = [];
    public int $fetchUserCalls = 0;

    public function setAsStateless(): void
    {
    }

    public function redirect(array $scopes, array $options)
    {
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

        return new OidcResourceOwner($this->claims);
    }

    public function getOAuth2Provider(): never
    {
        throw new \LogicException('Not available in tests');
    }
}
