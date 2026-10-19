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

    /** Whether the security token's session carries the consent claim as true. */
    public static function isOk(?TokenInterface $token): bool
    {
        return null !== $token && $token->hasAttribute(self::ATTRIBUTE) && true === $token->getAttribute(self::ATTRIBUTE);
    }

    #[AsEventListener(event: Events::JWT_AUTHENTICATED)]
    public function __invoke(JWTAuthenticatedEvent $event): void
    {
        $event->getToken()->setAttribute(self::ATTRIBUTE, true === ($event->getPayload()[TokenService::CONSENT_CLAIM] ?? null));
    }
}
