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

    /**
     * Creates every valid label set with a zero delta. A Prometheus-style store cannot see the first sample of a
     * new series in increase(); with the zero sample beforehand a rare first event (one passkey sign-in) counts.
     */
    public function initialize(): void
    {
        try {
            $counter = $this->telemetry->counter(self::NAME, '{login}', 'Sign-ins (session issued) and failed sign-in attempts');
            foreach ([true, false] as $success) {
                foreach (['password', 'passkey'] as $method) {
                    $counter->add(0, ['method' => $method, 'stage' => self::STAGE_PRIMARY, 'success' => $success]);
                }
                foreach ([...self::PROVIDERS, 'none'] as $provider) {
                    $counter->add(0, ['method' => 'sso', 'stage' => self::STAGE_PRIMARY, 'success' => $success, 'provider' => $provider]);
                }
                foreach (['totp', 'backup_code'] as $method) {
                    $counter->add(0, ['method' => $method, 'stage' => self::STAGE_MFA, 'success' => $success]);
                }
            }
        } catch (\Throwable) {
        }
    }
}
