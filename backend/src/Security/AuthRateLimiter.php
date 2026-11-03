<?php

declare(strict_types=1);

namespace App\Security;

use App\Exception\ApiProblemException;
use App\Service\EmailAddress;
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
        #[Autowire(service: 'limiter.auth_identify_ip')]
        private readonly RateLimiterFactory $identifyIp,
        #[Autowire(service: 'limiter.auth_identify_email')]
        private readonly RateLimiterFactory $identifyEmail,
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
        #[Autowire(service: 'limiter.passkey_register_attempt')]
        private readonly RateLimiterFactory $passkeyRegisterAttempt,
        #[Autowire(service: 'limiter.passkey_register_code')]
        private readonly RateLimiterFactory $passkeyRegisterCode,
        #[Autowire(service: 'limiter.invitation_user')]
        private readonly RateLimiterFactory $invitationUser,
        #[Autowire(service: 'limiter.invitation_club')]
        private readonly RateLimiterFactory $invitationClub,
        #[Autowire(service: 'limiter.invitation_resend')]
        private readonly RateLimiterFactory $invitationResend,
        #[Autowire(service: 'limiter.invitation_email')]
        private readonly RateLimiterFactory $invitationEmail,
        #[Autowire(service: 'limiter.invitation_preview_ip')]
        private readonly RateLimiterFactory $invitationPreviewIp,
        #[Autowire(service: 'limiter.oauth_register_ip')]
        private readonly RateLimiterFactory $oauthRegisterIp,
        #[Autowire(service: 'limiter.oauth_token_ip')]
        private readonly RateLimiterFactory $oauthTokenIp,
        #[Autowire(service: 'limiter.oauth_decision_user')]
        private readonly RateLimiterFactory $oauthDecisionUser,
        #[Autowire(service: 'limiter.mcp_grant')]
        private readonly RateLimiterFactory $mcpGrant,
        #[Autowire(service: 'limiter.mcp_ip')]
        private readonly RateLimiterFactory $mcpIp,
        #[Autowire(service: 'limiter.feed_ip')]
        private readonly RateLimiterFactory $feedIp,
        #[Autowire(service: 'limiter.feed_id')]
        private readonly RateLimiterFactory $feedId,
        #[Autowire(service: 'limiter.pdf_export_user')]
        private readonly RateLimiterFactory $pdfExportUser,
        #[Autowire(service: 'limiter.pdf_export_ip')]
        private readonly RateLimiterFactory $pdfExportIp,
        #[Autowire('%env(int:FEED_RATE_LIMIT_PER_IP)%')]
        private readonly int $feedIpLimit,
        #[Autowire('%env(int:FEED_RATE_LIMIT_PER_FEED)%')]
        private readonly int $feedIdLimit,
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

    /** E-mail-first identify step: every request counts against the client IP and the address bucket. */
    public function assertIdentifyAllowed(Request $request, string $email): void
    {
        self::assertAccepted($this->identifyIp->create(self::ip($request))->consume());
        self::assertAccepted($this->identifyEmail->create(self::normalize($email))->consume());
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

    /** Re-authentication attempts for passkey registration (password or mailed code): per client IP and user. */
    public function assertPasskeyRegisterAllowed(Request $request, string $userId): void
    {
        self::assertAccepted($this->otherIp->create(self::ip($request))->consume());
        self::assertAccepted($this->passkeyRegisterAttempt->create($userId)->consume());
    }

    /** Mails of the passkey registration code: 5 per user and hour. */
    public function assertPasskeyRegisterCodeAllowed(Request $request, string $userId): void
    {
        self::assertAccepted($this->otherIp->create(self::ip($request))->consume());
        self::assertAccepted($this->passkeyRegisterCode->create($userId)->consume());
    }

    /** Creating or re-sending a club invitation: 20 per user and day and 50 per club and day (M8). */
    public function assertInvitationAllowed(string $userId, string $clubId): void
    {
        self::assertAccepted($this->invitationUser->create($userId)->consume());
        self::assertAccepted($this->invitationClub->create($clubId)->consume());
    }

    /** Public invitation preview by token: 30 per client IP and 15 minutes. */
    public function assertInvitationPreviewAllowed(Request $request): void
    {
        self::assertAccepted($this->invitationPreviewIp->create(self::ip($request))->consume());
    }

    /** Cooldown of 60 seconds between two re-sends of the same invitation. */
    public function assertInvitationResendAllowed(string $invitationId): void
    {
        self::assertAccepted($this->invitationResend->create($invitationId)->consume());
    }

    /**
     * One address cannot be mail-bombed by invitations: 5 mails per address and day. Returns false over the
     * limit; the caller then sends no mail but answers as always (no oracle, no error).
     */
    public function allowInvitationMail(string $email): bool
    {
        return $this->invitationEmail->create(self::normalize($email))->consume()->isAccepted();
    }

    /** OAuth dynamic client registration: 10 per client IP and hour. */
    public function assertClientRegistrationAllowed(Request $request): void
    {
        self::assertAccepted($this->oauthRegisterIp->create(self::ip($request))->consume());
    }

    /** OAuth token and revoke endpoints: 60 per client IP and minute, shared. */
    public function assertOAuthTokenAllowed(Request $request): void
    {
        self::assertAccepted($this->oauthTokenIp->create(self::ip($request))->consume());
    }

    /** Consent decisions of the OAuth authorization flow: 30 per user and hour. */
    public function assertOAuthDecisionAllowed(string $userId): void
    {
        self::assertAccepted($this->oauthDecisionUser->create($userId)->consume());
    }

    /** MCP endpoint, checked before the token lookup: per client IP. */
    public function assertMcpIpAllowed(Request $request): void
    {
        self::assertAccepted($this->mcpIp->create(self::ip($request))->consume());
    }

    /** MCP endpoint, per authenticated grant. */
    public function assertMcpGrantAllowed(string $grantId): void
    {
        self::assertAccepted($this->mcpGrant->create($grantId)->consume());
    }

    /**
     * Public feed endpoints, checked before the feed is looked up: per client IP and per feed id from the URL
     * (unchecked, so unknown ids behave exactly like known ones). A limit of 0 switches that check off.
     */
    public function assertFeedAllowed(Request $request, string $feedId): void
    {
        if ($this->feedIpLimit > 0) {
            self::assertAccepted($this->feedIp->create(self::ip($request))->consume());
        }
        if ($this->feedIdLimit > 0) {
            self::assertAccepted($this->feedId->create($feedId)->consume());
        }
    }

    /** PDF export (expensive to render): 10 per user and 30 per client IP in 10 minutes. */
    public function assertPdfExportAllowed(Request $request, string $userId): void
    {
        self::assertAccepted($this->pdfExportUser->create($userId)->consume());
        self::assertAccepted($this->pdfExportIp->create(self::ip($request))->consume());
    }

    public static function normalize(string $email): string
    {
        return EmailAddress::normalize($email);
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
