<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\OpaqueRegisterFinishDto;
use App\Dto\Auth\OpaqueRegisterStartDto;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Opaque\Base64Url;
use App\Opaque\InvalidMessageException;
use App\Opaque\OpaqueReauthTickets;
use App\Opaque\OpaqueRegistrationStates;
use App\Opaque\OpaqueService;
use App\Opaque\OpaqueSignupStates;
use App\Opaque\OpaqueUpgradeTickets;
use App\Opaque\RegistrationRecord;
use App\Security\AuthRateLimiter;
use App\Security\CurrentUserResolver;
use App\Service\AccountService;
use App\Service\AuthService;
use App\Service\EmailAddress;
use App\Service\PasswordResetService;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/**
 * OPAQUE registration in four contexts (docs/ops/OPAQUE-PLAN.md 3.2), selected by the one credential field present:
 * signup (`email` / `registrationState`), password reset (`resetToken`), password change (`reauthTicket`, JWT) and
 * legacy upgrade (`upgradeTicket`, JWT). Every start returns a signed `registrationState` binding the key id of the
 * response (and, outside signup, user and context); the finish requires it and stores the record under that key. The credential identifier of the evaluation is never read from a client
 * field: signup uses the id minted into the signed state, reset the user of the link, change/upgrade the signed-in
 * user. Starts under a real user's key count against that user's and the IP's login limits (guessing oracle).
 * The password policy (8-128) is enforced by the client only; the server cannot see the password.
 * Inert (503 `opaque_unavailable`) unless OPAQUE_ENABLED.
 */
#[Route('/api/auth/opaque')]
class OpaqueRegisterController extends AbstractApiController
{
    private const string SIGNUP = 'signup';
    private const string RESET = 'reset';
    private const string CHANGE = 'change';
    private const string UPGRADE = 'upgrade';
    private const int REQUEST_LENGTH = 32;

    public function __construct(
        private readonly OpaqueService $opaque,
        private readonly OpaqueSignupStates $signupStates,
        private readonly OpaqueRegistrationStates $registrationStates,
        private readonly OpaqueReauthTickets $reauthTickets,
        private readonly OpaqueUpgradeTickets $upgradeTickets,
        private readonly AuthService $auth,
        private readonly AccountService $accounts,
        private readonly PasswordResetService $passwordResets,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly CurrentUserResolver $userResolver,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * Signup counts against the register limits (IP, address); the other contexts against the login limits of the
     * account the evaluation is bound to. Signup answers the same for taken and free addresses (`email_taken`
     * is reported by the finish, as POST /api/auth/register does).
     */
    #[Route('/register/start', methods: ['POST'])]
    public function registerStart(Request $request): JsonResponse
    {
        $this->assertEnabled();
        $dto = $this->deserializeDto($request, OpaqueRegisterStartDto::class);
        $context = self::context([self::SIGNUP => $dto->email, self::RESET => $dto->resetToken, self::CHANGE => $dto->reauthTicket, self::UPGRADE => $dto->upgradeTicket]);

        if (self::SIGNUP === $context) {
            $this->rateLimiter->assertRegisterAllowed($request);
            $this->validateDto($dto, $this->validator);
            $email = EmailAddress::normalize((string) $dto->email);
            $this->rateLimiter->assertRegisterEmailAllowed($email);
            $request32 = $this->decode($dto->registrationRequest, 'registrationRequest', self::REQUEST_LENGTH);
            $keyId = $this->opaque->activeKeyId();
            $issued = $this->signupStates->issue($email, $keyId);

            return new JsonResponse([
                'registrationResponse' => Base64Url::encode($this->respond($issued['userId'], $request32, $keyId)),
                'registrationState' => $issued['state'],
            ]);
        }

        $this->validateDto($dto, $this->validator);
        if (self::RESET === $context) {
            // Unknown links count against the IP before the lookup; a known one against the account too.
            $this->rateLimiter->assertOtherAllowed($request);
            $user = $this->passwordResets->userOfOpenToken((string) $dto->resetToken);
            $this->rateLimiter->assertLoginAllowed($request, $user->getEmail());
        } else {
            $user = $this->userResolver->resolve();
            $this->rateLimiter->assertLoginAllowed($request, $user->getEmail());
            if (self::CHANGE === $context && !$this->reauthTickets->isValid($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD, (string) $dto->reauthTicket)) {
                throw self::reauthRequired();
            }
            if (self::UPGRADE === $context) {
                $this->assertUpgradeable($user);
                if (!$this->upgradeTickets->isValid($user, (string) $dto->upgradeTicket)) {
                    throw self::reauthRequired();
                }
            }
        }
        $request32 = $this->decode($dto->registrationRequest, 'registrationRequest', self::REQUEST_LENGTH);

        $keyId = $this->opaque->activeKeyId();

        return new JsonResponse([
            'registrationResponse' => Base64Url::encode($this->respond($user->getId(), $request32, $keyId)),
            'registrationState' => $this->registrationStates->issue($user->getId(), $context, $keyId),
        ]);
    }

    /**
     * Signup: 201 `{verificationRequired, email}` + token pair (restricted session), like POST /api/auth/register.
     * Reset and upgrade: 204. Change: 200 with a new token pair (other sessions end).
     */
    #[Route('/register/finish', methods: ['POST'])]
    public function registerFinish(Request $request): JsonResponse
    {
        $this->assertEnabled();
        $dto = $this->deserializeDto($request, OpaqueRegisterFinishDto::class);
        $context = self::finishContext($dto);
        $this->validateDto($dto, $this->validator);
        $record = $this->decode($dto->registrationRecord, 'registrationRecord', RegistrationRecord::LENGTH);
        $this->assertRecord($record);

        try {
            return match ($context) {
                self::SIGNUP => $this->finishSignup($request, $dto, $record),
                self::RESET => $this->finishReset($dto, $record),
                self::CHANGE => $this->finishChange($dto, $record),
                default => $this->finishUpgrade($dto, $record),
            };
        } catch (InvalidMessageException $e) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', 'registrationRecord', [], $e);
        }
    }

    private function finishSignup(Request $request, OpaqueRegisterFinishDto $dto, string $record): JsonResponse
    {
        $state = $this->signupStates->open((string) $dto->registrationState);
        if (null === $state || !$this->opaque->hasKey($state['keyId'])) {
            throw self::stateInvalid();
        }
        $name = trim((string) $dto->name);
        if ('' === $name) {
            throw new ApiProblemException(422, 'name: must not be blank', 'validation_failed', 'name');
        }
        $claim = function () use ($state): void {
            if (!$this->signupStates->consume($state['jti'], $state['exp'])) {
                throw self::stateInvalid();
            }
        };
        $tokens = $this->auth->registerOpaque($state['userId'], $name, $state['email'], $record, $state['keyId'], $dto->language, $dto->acceptedDocuments, $claim, $request->getClientIp(), $request->headers->get('User-Agent'));

        return new JsonResponse(['verificationRequired' => true, 'email' => $state['email']] + $tokens, Response::HTTP_CREATED);
    }

    private function finishReset(OpaqueRegisterFinishDto $dto, string $record): JsonResponse
    {
        $user = $this->passwordResets->userOfOpenToken((string) $dto->resetToken);
        $keyId = $this->boundKeyId($dto, self::RESET, $user);
        $this->passwordResets->resetWithRecord((string) $dto->resetToken, $record, $keyId);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    private function finishChange(OpaqueRegisterFinishDto $dto, string $record): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $keyId = $this->boundKeyId($dto, self::CHANGE, $user);
        if (!$this->reauthTickets->consume($user, OpaqueReauthTickets::PURPOSE_CHANGE_PASSWORD, (string) $dto->reauthTicket)) {
            throw self::reauthRequired();
        }

        return new JsonResponse($this->accounts->changePasswordWithRecord($user, $record, $this->userResolver->sessionConsentOk(), $keyId));
    }

    /** Stores the record only: the bcrypt hash stays until phase 2 and running sessions stay valid. */
    private function finishUpgrade(OpaqueRegisterFinishDto $dto, string $record): JsonResponse
    {
        $user = $this->userResolver->resolve();
        $this->assertUpgradeable($user);
        $keyId = $this->boundKeyId($dto, self::UPGRADE, $user);
        if (!$this->upgradeTickets->consume($user, (string) $dto->upgradeTicket)) {
            throw self::reauthRequired();
        }
        $this->opaque->storeRecord($user, $record, $keyId);
        $this->em->flush();
        $this->logger->info('opaque.upgrade.success', ['userId' => $user->getId()]);

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }

    private function assertUpgradeable(User $user): void
    {
        if (null !== $user->getOpaqueRecord()) {
            throw new ApiProblemException(409, 'This account already has an OPAQUE password', 'opaque_already_registered');
        }
    }

    /** Key id of the start's response; a missing, foreign or stale state is 409 (the client restarts). */
    private function boundKeyId(OpaqueRegisterFinishDto $dto, string $context, User $user): string
    {
        $keyId = null === $dto->registrationState || '' === $dto->registrationState
            ? null
            : $this->registrationStates->keyId($dto->registrationState, $context, $user->getId());
        if (null === $keyId || !$this->opaque->hasKey($keyId)) {
            throw self::stateInvalid();
        }

        return $keyId;
    }

    private function respond(string $credentialId, string $request, string $keyId): string
    {
        try {
            return $this->opaque->registrationResponseFor($credentialId, $request, $keyId);
        } catch (InvalidMessageException $e) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', 'registrationRequest', [], $e);
        }
    }

    private function assertRecord(string $record): void
    {
        try {
            $this->opaque->assertValidRecord($record);
        } catch (InvalidMessageException $e) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', 'registrationRecord', [], $e);
        }
    }

    /** @param array<string, ?string> $fields context => credential field */
    private static function context(array $fields): string
    {
        $present = array_keys(array_filter($fields, static fn (?string $value): bool => null !== $value && '' !== $value));
        if (1 !== count($present)) {
            throw new ApiProblemException(400, 'Exactly one of '.implode(', ', array_keys($fields)).' credentials is required', 'invalid_request');
        }

        return $present[0];
    }

    /** The credential field picks the context; `registrationState` alone is signup, otherwise it only binds the key id. */
    private static function finishContext(OpaqueRegisterFinishDto $dto): string
    {
        $others = array_filter([self::RESET => $dto->resetToken, self::CHANGE => $dto->reauthTicket, self::UPGRADE => $dto->upgradeTicket], static fn (?string $v): bool => null !== $v && '' !== $v);
        if (count($others) > 1) {
            throw new ApiProblemException(400, 'Exactly one of resetToken, reauthTicket, upgradeTicket credentials is required', 'invalid_request');
        }
        if ([] !== $others) {
            return (string) array_key_first($others);
        }
        if (null === $dto->registrationState || '' === $dto->registrationState) {
            throw new ApiProblemException(400, 'Exactly one of registrationState, resetToken, reauthTicket, upgradeTicket credentials is required', 'invalid_request');
        }

        return self::SIGNUP;
    }

    private static function stateInvalid(): ApiProblemException
    {
        return new ApiProblemException(409, 'The registration state is invalid, expired or was used before', 'opaque_state_invalid', 'registrationState');
    }

    private static function reauthRequired(): ApiProblemException
    {
        return new ApiProblemException(403, 'A fresh re-authentication ticket is required', 'reauth_required');
    }

    private function assertEnabled(): void
    {
        if (!$this->opaque->isEnabled()) {
            throw new ApiProblemException(503, 'OPAQUE login is not available', 'opaque_unavailable');
        }
    }

    private function decode(string $value, string $field, int $length): string
    {
        $bytes = Base64Url::decode($value);
        if (null === $bytes || $length !== strlen($bytes)) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', $field);
        }

        return $bytes;
    }

    private function deserializeDto(Request $request, string $class): object
    {
        try {
            return $this->serializer->deserialize($request->getContent(), $class, 'json');
        } catch (SerializerException $e) {
            throw self::invalidJson('Invalid JSON body', $e);
        }
    }
}
