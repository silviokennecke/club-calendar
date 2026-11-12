<?php

declare(strict_types=1);

namespace App\Security\StepUp;

/**
 * Marks a controller (class) or action (method) as a sensitive action: the request must carry a valid step-up
 * token in the `X-Step-Up-Token` header (see {@see StepUpTokenService}), else 403 `step_up_required`. Enforced by
 * {@see StepUpListener} after the authentication and the e-mail and consent gates.
 */
#[\Attribute(\Attribute::TARGET_CLASS | \Attribute::TARGET_METHOD)]
final class RequiresStepUp
{
    /** @param string|null $whenJsonTrue only enforced when this key of the JSON body is `true` (e.g. approving, not denying) */
    public function __construct(public readonly ?string $whenJsonTrue = null)
    {
    }
}
