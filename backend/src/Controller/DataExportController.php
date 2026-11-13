<?php

declare(strict_types=1);

namespace App\Controller;

use App\Enum\SecurityEventType;
use App\Export\UserDataExportService;
use App\Security\AuthRateLimiter;
use App\Security\ClientContextResolver;
use App\Security\CurrentUserResolver;
use App\Security\StepUp\RequiresStepUp;
use App\Service\AccountMailer;
use App\Service\SecurityEventLogger;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Download of all personal data (GDPR Art. 15/20). Needs a step-up token; stays behind the e-mail
 * verification and consent gates on purpose (gated accounts ask the operator).
 */
class DataExportController extends AbstractApiController
{
    public function __construct(
        private readonly UserDataExportService $export,
        private readonly CurrentUserResolver $userResolver,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly ClientContextResolver $clientContext,
        private readonly SecurityEventLogger $events,
        private readonly AccountMailer $mailer,
    ) {
    }

    /**
     * Streams the export as JSON (no Content-Length). The rate-limit slots are refunded when the export does
     * not complete (error or aborted connection); the security event and the notice mail follow only a complete one.
     */
    #[Route('/api/auth/me/export', methods: ['POST'])]
    #[RequiresStepUp]
    public function export(Request $request): Response
    {
        $user = $this->userResolver->resolve();
        $ticket = $this->rateLimiter->assertDataExportAllowed($request, $user->getId());
        $context = $this->clientContext->current();

        $response = new StreamedResponse(function () use ($user, $ticket, $context): void {
            $memoryLimit = ini_get('memory_limit');
            $timeLimit = (int) ini_get('max_execution_time');
            $ignoreAbort = ignore_user_abort(true);
            ini_set('memory_limit', '256M');
            set_time_limit(300);
            $complete = false;
            try {
                foreach ($this->export->chunks($user) as $chunk) {
                    echo $chunk;
                    flush();
                    if (connection_aborted()) {
                        return;
                    }
                }
                $complete = true;
            } finally {
                ini_set('memory_limit', false === $memoryLimit ? '-1' : $memoryLimit);
                set_time_limit($timeLimit);
                ignore_user_abort((bool) $ignoreAbort);
                if (!$complete) {
                    $ticket->release();
                }
            }
            $this->events->record($user, SecurityEventType::DATA_EXPORT, true, null, null, $context);
            $this->mailer->sendDataExported($user, $context);
        });
        $response->headers->add([
            'Content-Type' => 'application/json; charset=utf-8',
            'Content-Disposition' => sprintf('attachment; filename="club-calendar-export-%s-%s.json"', $user->getId(), gmdate('Ymd')),
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Robots-Tag' => 'noindex',
        ]);

        return $response;
    }
}
