<?php

declare(strict_types=1);

namespace App\Telemetry;

/**
 * Delta counter of sign-in outcomes, recorded live at the point a session is issued (success) or a credential
 * check was evaluated and failed. Never a user, address, IP or provider-account attribute; any error is swallowed.
 */
final class LoginMetrics
{
    public const NAME = 'club_calendar.logins';
    public const STAGE_PRIMARY = 'primary';
    public const STAGE_MFA = 'mfa';
    private const PROVIDERS = ['google', 'microsoft', 'apple'];

    public function __construct(private readonly Telemetry $telemetry)
    {
    }

    /** @param string $method password|passkey|sso|totp|backup_code; $stage primary|mfa */
    public function record(bool $success, string $method, string $stage, ?string $provider = null): void
    {
        try {
            $attributes = ['method' => $method, 'stage' => $stage, 'success' => $success];
            if ('sso' === $method) {
                $attributes['provider'] = in_array($provider, self::PROVIDERS, true) ? $provider : 'none';
            }
            $this->telemetry->counter(self::NAME, '{login}', 'Sign-ins (session issued) and failed sign-in attempts')->add(1, $attributes);
        } catch (\Throwable) {
        }
    }
}
