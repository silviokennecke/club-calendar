<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\OpaqueLoginFinishDto;
use App\Dto\Auth\OpaqueLoginStartDto;
use App\Entity\User;
use App\Exception\ApiProblemException;
use App\Opaque\AuthenticationFailedException;
use App\Opaque\Base64Url;
use App\Opaque\InvalidMessageException;
use App\Opaque\Ke1;
use App\Opaque\OpaqueService;
use App\Security\AuthRateLimiter;
use App\Service\AuthService;
use App\Service\EmailAddress;
use Doctrine\ORM\EntityManagerInterface;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Serializer\Exception\ExceptionInterface as SerializerException;
use Symfony\Component\Serializer\SerializerInterface;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/** OPAQUE password login (docs/ops/OPAQUE-PLAN.md 3.2) */
#[Route('/api/auth/opaque')]
class OpaqueLoginController extends AbstractApiController
{
    private const int KE3_LENGTH = 64;

    public function __construct(
        private readonly OpaqueService $opaque,
        private readonly AuthService $auth,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly ValidatorInterface $validator,
        private readonly SerializerInterface $serializer,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
    ) {
    }

    /**
     * Same answer shape for unknown addresses, accounts without a record and real accounts. This is where password
     * guesses are made (every KE2 is one offline-checkable attempt for the client), so it consumes the login limits.
     */
    #[Route('/login/start', methods: ['POST'])]
    public function loginStart(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, OpaqueLoginStartDto::class);
        $this->validateDto($dto, $this->validator);
        $this->rateLimiter->assertLoginAllowed($request, $dto->email);
        $ke1 = $this->decode($dto->startLoginRequest, 'startLoginRequest', Ke1::LENGTH);

        $email = EmailAddress::normalize($dto->email);
        $user = $this->em->getRepository(User::class)->findOneBy(['email' => $email]);
        try {
            $challenge = $this->opaque->startLogin($user, $email, $ke1);
        } catch (InvalidMessageException $e) {
            throw new ApiProblemException(400, 'Invalid OPAQUE message', 'invalid_opaque_message', 'startLoginRequest', [], $e);
        }

        return new JsonResponse([
            'loginResponse' => Base64Url::encode($challenge->ke2),
            'loginState' => $challenge->loginState,
            'ksfProfile' => $challenge->ksfProfile,
        ]);
    }

    /**
     * Every failure after the format checks is the same 401. No address bucket is consumed here (start did, the
     * state is single use); the success reset uses the address of the sealed state's user, never the request.
     */
    #[Route('/login/finish', methods: ['POST'])]
    public function loginFinish(Request $request): JsonResponse
    {
        $dto = $this->deserializeDto($request, OpaqueLoginFinishDto::class);
        $this->validateDto($dto, $this->validator);
        $ke3 = $this->decode($dto->finishLoginRequest, 'finishLoginRequest', self::KE3_LENGTH);

        try {
            $user = $this->opaque->finishLogin($dto->loginState, $ke3);
        } catch (InvalidMessageException|AuthenticationFailedException $e) {
            $this->logger->info('opaque.login.failure', ['reason' => $e instanceof InvalidMessageException ? 'invalid_state' : 'authentication_failed']);
            throw new ApiProblemException(401, 'Invalid credentials', 'invalid_credentials', null, ['WWW-Authenticate' => 'Bearer'], $e);
        }
        $this->rateLimiter->recordLoginSuccess($user->getEmail());
        $this->logger->info('opaque.login.success', ['userId' => $user->getId()]);

        return new JsonResponse($this->auth->completeLogin($user));
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
