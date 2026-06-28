<?php

declare(strict_types=1);

namespace App\Controller;

use App\OAuth\OidcResourceOwner;
use App\Service\AuthService;
use KnpU\OAuth2ClientBundle\Client\ClientRegistry;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/auth/oauth')]
class OAuthController extends AbstractController
{
    public function __construct(
        private readonly ClientRegistry $clientRegistry,
        private readonly AuthService $authService,
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/{provider}', name: 'oauth_redirect', methods: ['GET'])]
    public function start(string $provider): Response
    {
        try {
            return $this->clientRegistry->getClient($provider)->redirect([], []);
        } catch (\InvalidArgumentException) {
            return new Response('Unknown provider', 400);
        }
    }

    #[Route('/{provider}/callback', name: 'oauth_callback', methods: ['GET', 'POST'])]
    public function callback(string $provider): Response
    {
        try {
            $client = $this->clientRegistry->getClient($provider);
            $resourceOwner = $client->fetchUser();

            assert($resourceOwner instanceof OidcResourceOwner);

            $email = $resourceOwner->getEmail();
            $name = $resourceOwner->getName();
            $providerId = (string) $resourceOwner->getId();

            if (!$email) {
                throw new \RuntimeException('No email returned from OAuth provider');
            }

            $tokens = $this->authService->findOrCreateOAuthUser($provider, $providerId, $email, $name ?? $email);

            $redirectUrl = $this->frontendUrl.'/auth/callback?'.http_build_query([
                'token' => $tokens['access_token'],
                'refresh_token' => $tokens['refresh_token'],
            ]);

            return new RedirectResponse($redirectUrl);
        } catch (\Exception $e) {
            $errorUrl = $this->frontendUrl.'/auth/callback?error='.urlencode($e->getMessage());

            return new RedirectResponse($errorUrl);
        }
    }
}
