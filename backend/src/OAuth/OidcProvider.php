<?php
declare(strict_types=1);

namespace App\OAuth;

use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;

class OidcProvider extends GenericProvider
{
    private readonly string $issuer;
    private readonly array $defaultAuthorizationParams;
    private ?array $discovery = null;

    public function __construct(array $options = [], array $collaborators = [])
    {
        $this->issuer                    = rtrim($options['issuer'] ?? '', '/');
        $this->defaultAuthorizationParams = $options['defaultAuthorizationParams'] ?? [];
        unset($options['defaultAuthorizationParams']);
        // GenericProvider requires these three; we override the methods so the stored values are never used
        $options['urlAuthorize']            ??= '';
        $options['urlAccessToken']          ??= '';
        $options['urlResourceOwnerDetails'] ??= '';
        parent::__construct($options, $collaborators);
    }

    protected function getRequiredOptions(): array
    {
        return ['issuer'];
    }

    public function getBaseAuthorizationUrl(): string
    {
        return $this->discover()['authorization_endpoint'];
    }

    public function getBaseAccessTokenUrl(array $params): string
    {
        return $this->discover()['token_endpoint'];
    }

    public function getResourceOwnerDetailsUrl(AccessToken $token): string
    {
        return $this->discover()['userinfo_endpoint'] ?? '';
    }

    public function buildAuthorizationUrl(array $options = []): string
    {
        return parent::buildAuthorizationUrl(array_merge($this->defaultAuthorizationParams, $options));
    }

    public function getResourceOwner(AccessToken $token): OidcResourceOwner
    {
        $claims = $this->parseIdToken($token);

        $userInfoUrl = $this->getResourceOwnerDetailsUrl($token);
        if (empty($claims['email']) && !empty($userInfoUrl)) {
            try {
                $response = $this->fetchResourceOwnerDetails($token);
                $claims   = array_merge($claims, $response);
            } catch (\Throwable) {
                // Fall back to ID token claims only
            }
        }

        return new OidcResourceOwner($claims);
    }

    private function discover(): array
    {
        if ($this->discovery === null) {
            $url = $this->issuer . '/.well-known/openid-configuration';
            $response = $this->getHttpClient()->get($url);
            $this->discovery = json_decode((string) $response->getBody(), true) ?? [];
        }

        return $this->discovery;
    }

    private function parseIdToken(AccessToken $token): array
    {
        $idToken = $token->getValues()['id_token'] ?? null;
        if (!is_string($idToken)) {
            return [];
        }

        $parts = explode('.', $idToken);
        if (count($parts) !== 3) {
            return [];
        }

        $padded  = str_pad(strtr($parts[1], '-_', '+/'), (int) ceil(strlen($parts[1]) / 4) * 4, '=');
        $payload = base64_decode($padded, true);

        return $payload !== false ? (json_decode($payload, true) ?? []) : [];
    }
}
