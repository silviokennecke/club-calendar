<?php

declare(strict_types=1);

namespace App\Controller;

use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Well-known URL for changing passwords (https://w3c.github.io/webappsec-change-password-url/). The target comes
 * from FRONTEND_URL, never from the request.
 */
#[AsController]
class ChangePasswordUrlController
{
    public function __construct(
        #[Autowire(env: 'FRONTEND_URL')]
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/.well-known/change-password', methods: ['GET'])]
    public function __invoke(): RedirectResponse
    {
        return new RedirectResponse(rtrim($this->frontendUrl, '/').'/profile#pr-pw', 302);
    }
}
