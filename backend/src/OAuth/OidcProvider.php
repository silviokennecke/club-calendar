<?php
declare(strict_types=1);

namespace App\OAuth;

use League\OAuth2\Client\Provider\GenericProvider;
use League\OAuth2\Client\Token\AccessToken;

class OidcProvider extends GenericProvider
{
    private array $defaultAuthorizationParams = [];

    public function __construct(array $options = [], array $collaborators = [])
    {
        $this->defaultAuthorizationParams = $options['defaultAuthorizationParams'] ?? [];
        unset($options['defaultAuthorizationParams']);
        // Make userinfo endpoint optional; Apple uses only the ID token claims
        $options['urlResourceOwnerDetails'] ??= '';
        parent::__construct($options, $collaborators);
    }

    public function buildAuthorizationUrl(array $options = []): string
    {
        return parent::buildAuthorizationUrl(array_merge($this->defaultAuthorizationParams, $options));
    }

    public function getResourceOwner(AccessToken $token): OidcResourceOwner
    {
        $claims = $this->parseIdToken($token);

        if (empty($claims['email']) && !empty($this->getResourceOwnerDetailsUrl($token))) {
            try {
                $response = $this->fetchResourceOwnerDetails($token);
                $claims   = array_merge($claims, $response);
            } catch (\Throwable) {
                // Fall back to ID token claims only
            }
        }

        return new OidcResourceOwner($claims);
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
