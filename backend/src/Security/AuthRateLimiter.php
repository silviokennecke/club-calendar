<?php

declare(strict_types=1);

namespace App\Security;

use App\Exception\ApiProblemException;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\RateLimiter\RateLimit;
use Symfony\Component\RateLimiter\RateLimiterFactory;

/**
 * Brute-force and abuse limits of the unauthenticated auth endpoints (login, register, token refresh, e-mail
 * confirmation, passkeys, SSO). Over a limit the answer is 429 `rate_limited` with `Retry-After`. Every check
 * runs before the expensive work (password hashing, database, mail) and behaves identically for known and
 * unknown addresses, so the limits reveal no account.
 *
 * The client IP is `Request::getClientIp()`: behind a reverse proxy `framework.trusted_proxies` must be set
 * (`SYMFONY_TRUSTED_PROXIES`), otherwise all clients share the proxy's address.
 */
class AuthRateLimiter
{
    public function __construct(
        #[Autowire(service: 'limiter.auth_login_ip')]
        private readonly RateLimiterFactory $loginIp,
        #[Autowire(service: 'limiter.auth_login_email')]
        private readonly RateLimiterFactory $loginEmail,
        #[Autowire(service: 'limiter.auth_register_ip')]
        private readonly RateLimiterFactory $registerIp,
        #[Autowire(service: 'limiter.auth_register_email')]
        private readonly RateLimiterFactory $registerEmail,
        #[Autowire(service: 'limiter.auth_refresh_ip')]
        private readonly RateLimiterFactory $refreshIp,
        #[Autowire(service: 'limiter.auth_other_ip')]
        private readonly RateLimiterFactory $otherIp,
        #[Autowire(service: 'limiter.verification_resend_ip')]
        private readonly RateLimiterFactory $verificationResendIp,
        #[Autowire(service: 'limiter.account_delete_attempt')]
        private readonly RateLimiterFactory $accountDeleteAttempt,
        #[Autowire(service: 'limiter.account_delete_code')]
        private readonly RateLimiterFactory $accountDeleteCode,
    ) {
    }

    /**
     * Every attempt counts against the client IP and against the address bucket; a successful sign-in clears
     * the bucket of that address (recordLoginSuccess), so in effect only failures (and attempts since the last
     * success) accumulate, and nobody can clear the bucket of an account without knowing its password.
     */
    public function assertLoginAllowed(Request $request, string $email): void
    {
        self::assertAccepted($this->loginIp->create(self::ip($request))->consume());
        self::assertAccepted($this->loginEmail->create(self::normalize($email))->consume());
    }

    /** A successful sign-in clears the failures of that address. */
    public function recordLoginSuccess(string $email): void
    {
        $this->loginEmail->create(self::normalize($email))->reset();
    }

    public function assertRegisterAllowed(Request $request): void
    {
        self::assertAccepted($this->registerIp->create(self::ip($request))->consume());
    }

    /** One address cannot be mail-bombed through the registration. */
    public function assertRegisterEmailAllowed(string $email): void
    {
        self::assertAccepted($this->registerEmail->create(self::normalize($email))->consume());
    }

    public function assertRefreshAllowed(Request $request): void
    {
        self::assertAccepted($this->refreshIp->create(self::ip($request))->consume());
    }

    /** E-mail confirmation, passkey options/verify and SSO start/callback. */
    public function assertOtherAllowed(Request $request): void
    {
        self::assertAccepted($this->otherIp->create(self::ip($request))->consume());
    }

    /** Resend of the e-mail confirmation code: 25 per client IP and day. */
    public function assertResendVerificationAllowed(Request $request): void
    {
        self::assertAccepted($this->verificationResendIp->create(self::ip($request))->consume());
    }

    /**
     * Confirmation attempts of the account deletion (password or mailed code): per client IP and per user, so
     * a stolen access token cannot be used to guess the password or the code. Every attempt counts.
     */
    public function assertAccountDeleteAllowed(Request $request, string $userId): void
    {
        self::assertAccepted($this->otherIp->create(self::ip($request))->consume());
        self::assertAccepted($this->accountDeleteAttempt->create($userId)->consume());
    }

    /** Mails of the deletion code: 5 per user and hour. */
    public function assertAccountDeleteCodeAllowed(Request $request, string $userId): void
    {
        self::assertAccepted($this->otherIp->create(self::ip($request))->consume());
        self::assertAccepted($this->accountDeleteCode->create($userId)->consume());
    }

    public static function normalize(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    private static function ip(Request $request): string
    {
        return $request->getClientIp() ?? 'unknown';
    }

    private static function assertAccepted(RateLimit $limit): void
    {
        if ($limit->isAccepted()) {
            return;
        }
        $retryAfter = max(1, $limit->getRetryAfter()->getTimestamp() - time());

        throw new ApiProblemException(429, 'Too many requests', 'rate_limited', null, ['Retry-After' => (string) $retryAfter]);
    }
}
