<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\ChangeEmailDto;
use App\Dto\Auth\ChangePasswordDto;
use App\Dto\Auth\ForgotPasswordDto;
use App\Dto\Auth\LoginDto;
use App\Dto\Auth\RegisterDto;
use App\Dto\Auth\ResendVerificationDto;
use App\Dto\Auth\ResetPasswordDto;
use App\Dto\Auth\UpdateMeDto;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Exception\EmailNotVerifiedException;
use App\Security\CurrentUserResolver;
use App\Service\AccountService;
use App\Service\AuthService;
use App\Service\EmailVerificationService;
use App\Service\Input;
use App\Service\PasswordResetService;
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
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly ClientRegistry $clientRegistry,
        private readonly EmailVerificationService $verificationService,
        private readonly EntityManagerInterface $em,
        #[Autowire(service: 'limiter.email_verification_resend')]
        private readonly RateLimiterFactory $emailVerificationResendLimiter,
        private readonly PasswordResetService $passwordResets,
        private readonly AccountService $accounts,
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
        try {
            $dto = $this->serializer->deserialize($request->getContent(), RegisterDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $this->auth->register($dto->name, $dto->email, $dto->password, $dto->language);

        return new JsonResponse(['message' => 'check_your_email'], Response::HTTP_ACCEPTED);
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
        try {
            return new JsonResponse($this->auth->login($dto->email, $dto->password));
        } catch (EmailNotVerifiedException) {
            // `error` is the original (still supported) form; `code` is the same as in all other API errors.
            return new JsonResponse(['error' => 'email_not_verified', 'code' => 'email_not_verified'], Response::HTTP_FORBIDDEN);
        }
    }

    #[Route('/resend-verification', methods: ['POST'])]
    public function resendVerification(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), ResendVerificationDto::class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body: '.$e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);

        $limiter = $this->emailVerificationResendLimiter->create($dto->email);
        $limit = $limiter->consume();
        if (!$limit->isAccepted()) {
            return new JsonResponse(null, Response::HTTP_NO_CONTENT);
        }

        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $dto->email]);
        if (!$user || $user->isEmailVerified()) {
            return new JsonResponse(null, Response::HTTP_NO_CONTENT);
        }

        $this->auth->sendVerificationEmail($user);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    #[Route('/verify-email', name: 'api_auth_verify_email', methods: ['GET'])]
    public function verifyEmail(Request $request): RedirectResponse
    {
        $id = (string) $request->query->get('id', '');
        $token = (string) $request->query->get('token', '');
        $result = $this->verificationService->verify($id, $token);

        if ('success' === $result) {
            return new RedirectResponse($this->frontendUrl.'/auth/verify-email?status=success');
        }

        return new RedirectResponse(
            $this->frontendUrl.'/auth/verify-email?status=error&reason='.$result,
        );
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

        $byEmail = $this->passwordResetEmailLimiter->create(mb_strtolower(trim($dto->email)))->consume();
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

        return new JsonResponse($this->accounts->changePassword($user, $dto->currentPassword, $dto->newPassword));
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
        $grantType = $request->request->get('grant_type');
        $refreshToken = $request->request->get('refresh_token');
        if ('refresh_token' !== $grantType || empty($refreshToken)) {
            throw new ApiProblemException(400, 'Invalid grant type or missing refresh_token', 'invalid_grant');
        }

        return new JsonResponse($this->auth->refresh($refreshToken));
    }

    #[Route('/logout', methods: ['POST'])]
    public function logout(): JsonResponse
    {
        return new JsonResponse(['ok' => true]);
    }

    #[Route('/me', methods: ['GET'])]
    public function getMe(): JsonResponse
    {
        $user = $this->userResolver->resolve();

        return new JsonResponse($this->auth->getMe($user));
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

        return new JsonResponse($this->auth->updateMe($user, $data));
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

    #[Route('/me', methods: ['DELETE'])]
    public function deleteMe(): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->auth->deleteMe($user);

        return new JsonResponse(['ok' => true]);
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
