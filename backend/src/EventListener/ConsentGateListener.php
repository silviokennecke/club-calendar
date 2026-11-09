<?php

declare(strict_types=1);

namespace App\EventListener;

use App\Entity\LegalDocument;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\SessionConsentListener;
use App\Service\LegalDocumentService;
use App\Service\LegalPresenter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;
use Symfony\Component\Security\Core\User\UserInterface;

/**
 * Consent gate: a signed-in user who has not consented to the current privacy policy / terms gets
 * 403 `consent_required` (+ `documents`) on every `/api/*` route except the allow-list below (reading the own
 * profile, giving consent, signing out, deleting the account, the public legal documents).
 *
 * Applies only to sessions that started without up-to-date consents (access token claim `lc` false/missing; see
 * `TokenService::tokenResponse`): a session that was compliant at its start passes without a query. Once the user
 * consents, the DB check passes for the non-compliant session too.
 *
 * Runs after the firewall (priority 8) has authenticated the JWT. Costs two queries per authenticated request
 * (current documents, consents); when no consent document exists, one.
 */
#[AsEventListener(event: KernelEvents::REQUEST, priority: 4)]
class ConsentGateListener
{
    /** Exact path => allowed methods. */
    private const array ALLOWED = [
        '/api/auth/me' => ['GET', 'DELETE'],
        '/api/auth/consents' => ['GET', 'POST'],
        '/api/auth/logout' => ['POST'],
        '/api/auth/logout-all' => ['POST'],
        '/api/auth/token' => ['POST'],
        '/api/auth/providers' => ['GET'],
        '/api/auth/registration' => ['GET'],
        '/api/auth/delete-account/code' => ['POST'],
        '/api/health' => ['GET'],
    ];

    public function __construct(
        private readonly TokenStorageInterface $tokenStorage,
        private readonly LegalDocumentService $legal,
        private readonly EntityManagerInterface $em,
    ) {
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
        $token = $this->tokenStorage->getToken();
        if (SessionConsentListener::isOk($token)) {
            // The session started with all consents given: a later document update does not lock it out.
            return;
        }
        $securityUser = $token?->getUser();
        if (!$securityUser instanceof UserInterface) {
            return;
        }
        $user = $securityUser instanceof User
            ? $securityUser
            : $this->em->getRepository(User::class)->findOneBy(['email' => $securityUser->getUserIdentifier()]);
        if (null === $user) {
            return;
        }
        $pending = $this->legal->pendingConsents($user);
        if ([] !== $pending) {
            throw self::required($pending);
        }
    }

    /** @param list<LegalDocument> $pending */
    public static function required(array $pending): ApiProblemException
    {
        return new ApiProblemException(
            403,
            'Consent to the current legal documents is required',
            'consent_required',
            null,
            [],
            null,
            ['documents' => LegalPresenter::refs($pending)],
        );
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
