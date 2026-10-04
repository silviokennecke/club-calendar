<?php

declare(strict_types=1);

namespace App\Security;

use App\Entity\User;
use App\Service\TokenService;
use Lexik\Bundle\JWTAuthenticationBundle\Exception\InvalidTokenException;
use Lexik\Bundle\JWTAuthenticationBundle\Security\Authenticator\JWTAuthenticator;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\Security\Http\Event\CheckPassportEvent;

/**
 * Rejects access tokens of ended sessions: issued before the user's credentials were revoked (token
 * version) or for a deleted account whose address now belongs to a new one. The user was just loaded
 * from the database by the JWT authenticator; a rejection ends in the authenticator's usual 401.
 */
#[AsEventListener(event: CheckPassportEvent::class, dispatcher: 'security.event_dispatcher.api')]
final readonly class SessionVersionListener
{
    public function __construct(
        private TokenService $tokens,
    ) {
    }

    public function __invoke(CheckPassportEvent $event): void
    {
        if (!$event->getAuthenticator() instanceof JWTAuthenticator) {
            return;
        }
        $passport = $event->getPassport();
        $payload = $passport->getAttribute('payload');
        $user = $passport->getUser();
        if (!is_array($payload) || !$user instanceof User || !$this->tokens->isCurrentSession($user, $payload)) {
            throw new InvalidTokenException('Invalid JWT Token');
        }
    }
}
