<?php

declare(strict_types=1);

namespace App\Security\StepUp;

use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\JwtProblemListener;
use App\Service\StepUpService;
use Symfony\Component\EventDispatcher\Attribute\AsEventListener;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;
use Symfony\Component\Security\Core\Authentication\Token\Storage\TokenStorageInterface;

/**
 * Enforces {@see RequiresStepUp}. Runs on `kernel.controller`, i.e. after every request listener: the firewall,
 * `access_control` and the e-mail and consent gates (priorities 5 and 4) have already answered, so their errors
 * win, and no controller code (body parsing, services) has run yet. A missing, malformed, expired or foreign
 * token is one and the same 403 `step_up_required`; its `methods` member tells the client which form to show.
 */
#[AsEventListener(event: KernelEvents::CONTROLLER)]
class StepUpListener
{
    public function __construct(
        private readonly TokenStorageInterface $tokenStorage,
        private readonly StepUpTokenService $tokens,
        private readonly StepUpService $stepUp,
    ) {
    }

    public function __invoke(ControllerEvent $event): void
    {
        if (!$event->isMainRequest() || [] === $event->getAttributes(RequiresStepUp::class)) {
            return;
        }
        $user = $this->tokenStorage->getToken()?->getUser();
        if (!$user instanceof User) {
            throw new ApiProblemException(401, 'Not authenticated', JwtProblemListener::MISSING_TOKEN_CODE, null, ['WWW-Authenticate' => 'Bearer']);
        }
        $this->tokens->requireFamily();
        if (!$this->tokens->accepts($event->getRequest()->headers->get(StepUpTokenService::HEADER), $user)) {
            throw new ApiProblemException(403, 'This action must be confirmed first', 'step_up_required', null, [], null, ['methods' => $this->stepUp->methods($user)]);
        }
    }
}
