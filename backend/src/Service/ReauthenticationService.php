<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\User;
use App\Exception\ApiProblemException;
use Psr\Clock\ClockInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\PasswordHasher\Hasher\UserPasswordHasherInterface;

/**
 * Re-authentication for sensitive actions: account deletion (AUTH-03) and passkey registration (L7). The code of
 * one purpose never validates for another (the purpose is part of the HMAC key). An account with a password confirms with that password.
 * An account without one (SSO-only, passkey-only) confirms with a 6-digit code mailed to its address: the
 * code is derived (HMAC of APP_SECRET over user, session version, address and a 10-minute window), so nothing
 * is stored; it is valid for the window it was issued in and the next one (10 to 20 minutes), ends with the
 * sessions (password set, takeover revocation) and with an address change. Attempts are limited per user and
 * client IP by the caller (`AuthRateLimiter`); a guess has a chance of 1 in 10^6 per try.
 */
readonly class ReauthenticationService
{
    public const int CODE_WINDOW = 600;
    public const string PURPOSE_DELETE_ACCOUNT = 'delete-account';
    public const string PURPOSE_PASSKEY = 'passkey-register';

    public function __construct(
        private UserPasswordHasherInterface $hasher,
        private AccountMailer $mailer,
        private ClockInterface $clock,
        #[Autowire(env: 'APP_SECRET')]
        private string $secret,
    ) {
    }

    /** Mails the current code (the same one within a window, so repeated requests do not invalidate it). */
    public function sendCode(User $user, string $purpose): void
    {
        if (null !== $user->getPassword()) {
            throw new ApiProblemException(409, 'This account has a password: confirm with it', 'has_password');
        }
        $code = $this->code($user, $purpose, $this->window());
        $minutes = intdiv(self::CODE_WINDOW, 60);
        if (self::PURPOSE_PASSKEY === $purpose) {
            $this->mailer->sendPasskeyCode($user, $code, $minutes);
        } else {
            $this->mailer->sendAccountDeletionCode($user, $code, $minutes);
        }
    }

    /**
     * @throws ApiProblemException 400 `invalid_credentials` (password missing or wrong, field `password`),
     *                             400 `invalid_confirmation_code` (code missing, wrong or expired, field `code`)
     */
    public function assertConfirmed(User $user, string $purpose, ?string $password, ?string $code): void
    {
        if (null !== $user->getPassword()) {
            if (null === $password || '' === $password || !$this->hasher->isPasswordValid($user, $password)) {
                throw new ApiProblemException(400, 'The password is not correct', 'invalid_credentials', 'password');
            }

            return;
        }
        $window = $this->window();
        $given = trim((string) $code);
        $valid = false;
        foreach ([$window, $window - 1] as $w) {
            $valid = hash_equals($this->code($user, $purpose, $w), $given) || $valid;
        }
        if (!$valid) {
            throw new ApiProblemException(400, 'The confirmation code is not correct or expired', 'invalid_confirmation_code', 'code');
        }
    }

    private function window(): int
    {
        return intdiv($this->clock->now()->getTimestamp(), self::CODE_WINDOW);
    }

    private function code(User $user, string $purpose, int $window): string
    {
        $key = hash_hmac('sha256', 'reauth-code|'.$purpose, $this->secret, true);
        $mac = hash_hmac('sha256', implode('|', [$user->getId(), $user->getTokenVersion(), $user->getEmail(), $window]), $key, true);
        $number = unpack('N', substr($mac, 0, 4))[1] % 1_000_000;

        return str_pad((string) $number, 6, '0', \STR_PAD_LEFT);
    }
}
