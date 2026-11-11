<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\ChangeEmailDto;
use App\Dto\Auth\ChangePasswordDto;
use App\Dto\Auth\DeleteAccountDto;
use App\Dto\Auth\ForgotPasswordDto;
use App\Dto\Auth\IdentifyDto;
use App\Dto\Auth\LoginDto;
use App\Dto\Auth\RegisterDto;
use App\Dto\Auth\ResetPasswordDto;
use App\Dto\Auth\UpdateMeDto;
use App\Dto\Auth\VerifyEmailDto;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Service\AccountService;
use App\Service\AuthService;
use App\Service\ClubCreationPolicy;
use App\Service\FeedProof;
use App\Service\Input;
use App\Service\LegalConsentService;
use App\Service\PasswordResetService;
use App\Service\ReauthenticationService;
use App\Service\RegistrationPolicy;
use Doctrine\ORM\EntityManagerInterface;
use KnpU\OAuth2ClientBundle\Client\ClientRegistry;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\RateLimiter\RateLimiterFactory;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

#[Route('/api/auth')]
class AuthController extends AbstractApiController
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly ClientRegistry $clientRegistry,
        private readonly PasswordResetService $passwordResets,
        private readonly AccountService $accounts,
        private readonly ReauthenticationService $reauth,
        private readonly LegalConsentService $legal,
        private readonly RegistrationPolicy $registrationPolicy,
        private readonly ClubCreationPolicy $clubCreationPolicy,
        private readonly EntityManagerInterface $em,
        #[Autowire(service: 'limiter.password_reset_email')]
        private readonly RateLimiterFactory $passwordResetEmailLimiter,
        #[Autowire(service: 'limiter.password_reset_ip')]
        private readonly RateLimiterFactory $passwordResetIpLimiter,
        #[Autowire(service: 'limiter.email_change_request')]
        private readonly RateLimiterFactory $emailChangeLimiter,
        #[Autowire(param: 'knpu_oauth2_client.providers_meta')]
        private readonly array $providersMeta,
        #[Autowire(env: 'FRONTEND_URL')]
        private readonly string $frontendUrl,
    ) {
    }

    #[Route('/register', methods: ['POST'])]
    public function register(Request $request): JsonResponse
    {
        $this->rateLimiter->assertRegisterAllowed($request);
        try {
            $dto = $this->serializer->deserialize($request->getContent(), RegisterDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $this->rateLimiter->assertRegisterEmailAllowed($dto->email);
        $tokens = $this->auth->register($dto->name, $dto->email, $dto->password, $dto->language, $dto->acceptedDocuments, $request->getClientIp(), $request->headers->get('User-Agent'), $this->feedProof($request, $dto->feedProof));

        // A restricted session: the address is confirmed with the code from the mail (POST /api/auth/verify-email).
        return new JsonResponse(['verificationRequired' => true, 'email' => $dto->email] + $tokens, Response::HTTP_CREATED);
    }

    /**
     * First step of the e-mail-first sign-in: 200 `{email, status}` with `login` (account exists, verified or
     * not), `register` or `registration_restricted`. Intentional account-existence oracle, limited per IP and
     * per address (checked before any database work).
     */
    #[Route('/identify', methods: ['POST'])]
    public function identify(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, IdentifyDto::class);
        $this->validateDto($dto, $this->validator);
        $email = AuthRateLimiter::normalize($dto->email);
        $this->rateLimiter->assertIdentifyAllowed($request, $email);
        if (null !== $this->em->getRepository(User::class)->findOneBy(['email' => $email])) {
            $status = 'login';
        } else {
            $status = $this->registrationPolicy->mayRegister($email, $this->feedProof($request, $dto->feedProof)) ? 'register' : 'registration_restricted';
        }

        return new JsonResponse(['email' => $email, 'status' => $status]);
    }

    /**
     * The optional feed proof of a restricted registration. Only read while registration is restricted; a proof
     * with a secret counts against the public feed limits (no brute force of private-feed secrets).
     */
    private function feedProof(Request $request, mixed $raw): ?FeedProof
    {
        if (!$this->registrationPolicy->isRestricted() || null === ($proof = FeedProof::fromInput($raw))) {
            return null;
        }
        if (null !== $proof->secret) {
            $this->rateLimiter->assertFeedAllowed($request, $proof->feedId);
        }

        return $proof;
    }

    #[Route('/login', methods: ['POST'])]
    public function login(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), LoginDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $this->rateLimiter->assertLoginAllowed($request, $dto->email);
        $tokens = $this->auth->login($dto->email, $dto->password);
        // With a second factor the sign-in is only finished by /mfa/verify
        if (!isset($tokens['mfaRequired'])) {
            $this->rateLimiter->recordLoginSuccess($dto->email);
        }

        return new JsonResponse($tokens);
    }

    /**
     * Mails a new confirmation code to the signed-in user (no body; 401 without a token). 204 when the address
     * is already verified and when a code went out; 429 `verification_resend_too_early` (+ `retryAt`) when the
     * account got a code mail less than 5 minutes ago; 429 `rate_limited` over 25 requests per client IP and day.
     */
    #[Route('/resend-verification', methods: ['POST'])]
    public function resendVerification(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertResendVerificationAllowed($request);
        $this->auth->resendVerificationCode($user);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /**
     * Confirms the signed-in user's address with the 6-digit code `{code}` (401 without a token). 200 with a
     * fresh token pair in a new session (the restricted one ends); 422 `invalid_verification_code` for every failure.
     */
    #[Route('/verify-email', methods: ['POST'])]
    public function verifyEmail(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertOtherAllowed($request);
        $dto = $this->deserializeDto($request, VerifyEmailDto::class);
        $this->validateDto($dto, $this->validator);

        return new JsonResponse($this->auth->verifyEmailCode($user, $dto->code));
    }

    /**
     * Always 204, whether or not the address has an account (also unconfirmed and SSO-only ones), and also
     * over the rate limit: the response never tells whether an account exists. The mail is sent after the
     * response (no timing difference from SMTP).
     */
    #[Route('/forgot-password', methods: ['POST'])]
    public function forgotPassword(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, ForgotPasswordDto::class);
        $this->validateDto($dto, $this->validator);

        $byEmail = $this->passwordResetEmailLimiter->create(AuthRateLimiter::normalize($dto->email))->consume();
        $byIp = $this->passwordResetIpLimiter->create((string) $request->getClientIp())->consume();
        if ($byEmail->isAccepted() && $byIp->isAccepted()) {
            $this->passwordResets->requestReset($dto->email);
        }

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /** 204 on success (all sessions ended; the user signs in again), 400 invalid_reset_token otherwise. */
    #[Route('/reset-password', methods: ['POST'])]
    public function resetPassword(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, ResetPasswordDto::class);
        $this->validateDto($dto, $this->validator);
        $this->passwordResets->reset($dto->token, $dto->password);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    /** Returns new tokens: all other sessions end, the calling session continues with these. */
    #[Route('/change-password', methods: ['POST'])]
    public function changePassword(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $dto = $this->deserializeDto($request, ChangePasswordDto::class);
        $this->validateDto($dto, $this->validator);

        return new JsonResponse($this->accounts->changePassword($user, $dto->currentPassword, $dto->newPassword, $this->userResolver->sessionConsentOk()));
    }

    /**
     * 204 whether or not the new address is free (no oracle); a confirmation link goes to the new address
     * only if it is. Over the rate limit also 204 without mail.
     */
    #[Route('/change-email', methods: ['POST'])]
    public function changeEmail(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $dto = $this->deserializeDto($request, ChangeEmailDto::class);
        $this->validateDto($dto, $this->validator);
        $dto->email = trim($dto->email);

        $this->accounts->assertPassword($user, (string) $dto->password, 'password');
        $send = $this->emailChangeLimiter->create($user->getId())->consume()->isAccepted();
        $this->accounts->requestEmailChange($user, $dto->email, $send);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/change-email', methods: ['DELETE'])]
    public function cancelEmailChange(): JsonResponse
    {
        $this->accounts->cancelEmailChange($this->userResolver->resolve());

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/verify-new-email', methods: ['GET'])]
    public function verifyNewEmail(Request $request): RedirectResponse
    {
        $result = $this->accounts->confirmEmailChange((string) $request->query->get('token', ''));
        $query = 'success' === $result
            ? ['status' => 'email_changed']
            : ['status' => 'error', 'reason' => $result, 'flow' => 'email_change'];

        return new RedirectResponse($this->frontendUrl.'/auth/verify-email?'.http_build_query($query));
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $class
     *
     * @return T
     */
    private function deserializeDto(Request $request, string $class): object
    {
        try {
            return $this->serializer->deserialize($request->getContent(), $class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body', $e);
        }
    }

    #[Route('/token', methods: ['POST'])]
    public function token(Request $request): JsonResponse
    {
        $this->rateLimiter->assertRefreshAllowed($request);
        $grantType = $request->request->get('grant_type');
        if ('one_time_token' === $grantType) {
            $token = $request->request->get('token');
            if (!is_string($token) || '' === $token) {
                throw new ApiProblemException(400, 'Missing token', 'invalid_grant');
            }

            $verifier = $request->request->get('code_verifier');

            return new JsonResponse($this->auth->redeemOneTimeToken($token, is_string($verifier) ? $verifier : null));
        }
        $refreshToken = $request->request->get('refresh_token');
        if ('refresh_token' !== $grantType || empty($refreshToken)) {
            throw new ApiProblemException(400, 'Invalid grant type or missing refresh_token/token', 'invalid_grant');
        }

        return new JsonResponse($this->auth->refresh($refreshToken));
    }

    /**
     * Ends the session of the refresh token in the JSON body (`{refresh_token}`): all its tokens are
     * revoked. Always `200 {"ok": true}`, whatever the body holds (unknown, expired, revoked, malformed or no
     * token): idempotent and no oracle. Clients leave out the (possibly expired) access token.
     */
    #[Route('/logout', methods: ['POST'])]
    public function logout(Request $request): JsonResponse
    {
        $data = json_decode($request->getContent(), true);
        $token = is_array($data) ? ($data['refresh_token'] ?? null) : null;
        if (is_string($token) && '' !== $token) {
            $this->auth->logout($token);
        }

        return new JsonResponse(['ok' => true]);
    }

    /** Signs out everywhere: access tokens (token version) and all refresh token families end. 204; the caller signs in again. */
    #[Route('/logout-all', methods: ['POST'])]
    public function logoutAll(): JsonResponse
    {
        $this->auth->logoutAll($this->userResolver->resolve());

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/me', methods: ['GET'])]
    public function getMe(): JsonResponse
    {
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->auth->getMe($user, $this->userResolver->sessionConsentOk()));
    }

    /** The user's consent history, newest first (own data: GDPR access, so IP and user agent are included). */
    #[Route('/consents', methods: ['GET'])]
    public function consents(): JsonResponse
    {
        return new JsonResponse($this->legal->consentHistory($this->userResolver->resolve()));
    }

    /**
     * `{documentIds}`: records the consent to these CURRENT privacy/terms documents (already given ones are
     * ignored); anything else is 422 `consent_outdated`. Responds with the new `/me` body.
     */
    #[Route('/consents', methods: ['POST'])]
    public function giveConsents(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = $this->decodeJson($request);
        $ids = $data['documentIds'] ?? null;
        if (!is_array($ids) || [] === $ids || count($ids) > 20 || array_filter($ids, static fn ($id): bool => !is_string($id))) {
            throw Input::invalid('documentIds', 'documentIds must be a non-empty list of document ids');
        }
        $this->legal->giveConsents($user, array_values($ids), $request->getClientIp(), $request->headers->get('User-Agent'));

        return new JsonResponse($this->auth->getMe($user, $this->userResolver->sessionConsentOk()));
    }

    #[Route('/me', methods: ['PATCH'])]
    public function updateMe(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $data = $this->decodeJson($request);
        $dto = new UpdateMeDto();
        if (array_key_exists('name', $data)) {
            if (!is_string($data['name'])) {
                throw new ApiProblemException(422, 'name: This value should be of type string.', 'validation_failed', 'name');
            }
            $data['name'] = trim($data['name']);
            $dto->name = $data['name'];
        }
        // Wrong JSON types end in 400 validation_failed (the DTO properties and entity setters are typed).
        if (array_key_exists('dateFormat', $data)) {
            $dto->dateFormat = self::stringField($data, 'dateFormat');
        }
        if (array_key_exists('firstDayOfWeek', $data)) {
            $dto->firstDayOfWeek = self::intField($data, 'firstDayOfWeek');
        }
        if (array_key_exists('language', $data)) {
            $dto->language = self::stringField($data, 'language');
        }
        if (array_key_exists('lastClubId', $data)) {
            $dto->lastClubId = self::stringField($data, 'lastClubId', nullable: true);
        }
        if (array_key_exists('lastCalendarId', $data)) {
            $dto->lastCalendarId = self::stringField($data, 'lastCalendarId', nullable: true);
        }
        $this->validateDto($dto, $this->validator);

        return new JsonResponse($this->auth->updateMe($user, $data, $this->userResolver->sessionConsentOk()));
    }

    /** A profile field that must be a JSON string (null only if nullable), else 400 validation_failed. */
    private static function stringField(array $data, string $field, bool $nullable = false): ?string
    {
        $value = $data[$field];
        if (is_string($value) || (null === $value && $nullable)) {
            return $value;
        }

        throw Input::invalid($field, sprintf('%s must be a string%s', $field, $nullable ? ' or null' : ''));
    }

    /** A profile field that must be a JSON integer, else 400 validation_failed ("1", 1.5, true are not). */
    private static function intField(array $data, string $field): int
    {
        $value = $data[$field];
        if (!is_int($value)) {
            throw Input::invalid($field, sprintf('%s must be an integer', $field));
        }

        return $value;
    }

    /**
     * Deletes the account after re-authentication: `{password}` for an account with a password, `{code}`
     * (mailed by `POST /delete-account/code`) for one without. 400 `invalid_credentials` /
     * `invalid_confirmation_code`, 429 `rate_limited`; nothing is deleted before the proof is valid.
     */
    #[Route('/me', methods: ['DELETE'])]
    public function deleteMe(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertAccountDeleteAllowed($request, $user->getId());
        $dto = '' === trim($request->getContent())
            ? new DeleteAccountDto()
            : $this->deserializeDto($request, DeleteAccountDto::class);
        $this->validateDto($dto, $this->validator);
        $this->reauth->assertConfirmed($user, ReauthenticationService::PURPOSE_DELETE_ACCOUNT, $dto->password, $dto->code);
        $this->auth->deleteMe($user);

        return new JsonResponse(['ok' => true]);
    }

    /** 204: a 6-digit code went to the account's address (accounts without password only; 409 `has_password` otherwise). */
    #[Route('/delete-account/code', methods: ['POST'])]
    public function sendDeleteAccountCode(Request $request): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->rateLimiter->assertAccountDeleteCodeAllowed($request, $user->getId());
        $this->reauth->sendCode($user, ReauthenticationService::PURPOSE_DELETE_ACCOUNT);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/registration', methods: ['GET'])]
    public function registration(): JsonResponse
    {
        return new JsonResponse([
            'restricted' => $this->registrationPolicy->isRestricted(),
            'clubCreationAllowed' => $this->clubCreationPolicy->isCreationAllowed(),
        ]);
    }

    #[Route('/providers', methods: ['GET'])]
    public function providers(): JsonResponse
    {
        $result = [];
        foreach ($this->clientRegistry->getEnabledClientKeys() as $id) {
            $envPrefix = strtoupper($id);
            if (empty($_ENV["{$envPrefix}_CLIENT_ID"]) || empty($_ENV["{$envPrefix}_CLIENT_SECRET"])) {
                continue;
            }
            $meta = $this->providersMeta[$id] ?? [];
            $result[] = [
                'id' => $id,
                'name' => $meta['label'] ?? ucfirst($id),
                'icon' => $meta['icon'] ?? $id,
            ];
        }

        return new JsonResponse($result);
    }
}
