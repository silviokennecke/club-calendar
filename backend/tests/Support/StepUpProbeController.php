<?php

declare(strict_types=1);

namespace App\Tests\Support;

use App\Security\StepUp\RequiresStepUp;
use Symfony\Component\HttpFoundation\JsonResponse;

/** Test-only route protected by #[RequiresStepUp] (config/routes/step_up_probe.yaml, test environment only). */
#[RequiresStepUp]
class StepUpProbeController
{
    public function __invoke(): JsonResponse
    {
        return new JsonResponse(['ok' => true]);
    }
}
