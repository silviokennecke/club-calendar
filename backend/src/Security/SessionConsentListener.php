<?php

declare(strict_types=1);

namespace App\Security;

use App\Service\TokenService;
use Lexik\Bundle\JWTAuthenticationBundle\Event\JWTAuthenticatedEvent;
use Lexik\Bundle\JWTAuthenticationBundle\Events;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\Security\Core\Authentication\Token\TokenInterface;

/**
 * Copies the consent claim (`lc`) of the authenticated access token to an attribute of the security token, where
 * {@see \App\EventListener\ConsentGateListener} and {@see CurrentUserResolver::sessionConsentOk()} read it.
 */
final class SessionConsentListener
{
    public const string ATTRIBUTE = 'consent_ok';
    public const string FAMILY_ATTRIBUTE = 'session_family';

    /** Whether the security token's session carries the consent claim as true. */
    public static function isOk(?TokenInterface $token): bool
    {
        return null !== $token && $token->hasAttribute(self::ATTRIBUTE) && true === $token->getAttribute(self::ATTRIBUTE);
    }

    /** Refresh-token family of the access token's session, null for tokens issued before the claim existed. */
    public static function family(?TokenInterface $token): ?string
    {
        $family = null !== $token && $token->hasAttribute(self::FAMILY_ATTRIBUTE) ? $token->getAttribute(self::FAMILY_ATTRIBUTE) : null;

        return is_string($family) ? $family : null;
    }

    #[AsEventListener(event: Events::JWT_AUTHENTICATED)]
    public function __invoke(JWTAuthenticatedEvent $event): void
    {
        $payload = $event->getPayload();
        $event->getToken()->setAttribute(self::ATTRIBUTE, true === ($payload[TokenService::CONSENT_CLAIM] ?? null));
        $event->getToken()->setAttribute(self::FAMILY_ATTRIBUTE, $payload[TokenService::FAMILY_CLAIM] ?? null);
    }
}
