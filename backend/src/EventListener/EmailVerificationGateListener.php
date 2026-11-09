<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Entity\User;
use App\Exception\ApiProblemException;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

/**
 * E-mail verification gate: a signed-in user whose address is not confirmed has a restricted session and gets
 * 403 `email_verification_required` on every `/api/*` route except the allow-list below (the own profile, the
 * confirmation itself, consent, signing out, the public legal documents). The firewall (priority 8) has already
 * loaded the user from the database, so the check costs no query. Runs before the consent gate.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 5)]
class EmailVerificationGateListener
{
    /** Exact path => allowed methods. */
    private const array ALLOWED = [
        '/api/auth/me' => ['GET', 'PATCH', 'DELETE'],
        '/api/auth/verify-email' => ['POST'],
        '/api/auth/resend-verification' => ['POST'],
        '/api/auth/consents' => ['GET', 'POST'],
        '/api/auth/logout' => ['POST'],
        '/api/auth/token' => ['POST'],
        '/api/auth/providers' => ['GET'],
        '/api/auth/registration' => ['GET'],
        '/api/auth/delete-account/code' => ['POST'],
        '/api/health' => ['GET'],
    ];

    public function __construct(private readonly TokenStorageInterface $tokenStorage)
    {
    }

    public function __invoke(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $request = $event->getRequest();
        $path = $request->getPathInfo();
        if (!str_starts_with($path, '/api/') || self::isAllowed($path, $request->getMethod()) || ReauthGateAllowance::allows($request)) {
            return;
        }
        $user = $this->tokenStorage->getToken()?->getUser();
        if ($user instanceof User && !$user->isEmailVerified()) {
            throw new ApiProblemException(403, 'The e-mail address must be confirmed first', 'email_verification_required', null, [], null, ['email' => $user->getEmail()]);
        }
    }

    private static function isAllowed(string $path, string $method): bool
    {
        if ('/api/legal' === $path || str_starts_with($path, '/api/legal/') || str_starts_with($path, '/api/feed/')) {
            return true;
        }
        $path = rtrim($path, '/');
        $method = 'HEAD' === $method ? 'GET' : $method;

        return in_array($method, self::ALLOWED[$path] ?? [], true);
    }
}
