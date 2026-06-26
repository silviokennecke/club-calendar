<?php
declare(strict_types=1);

namespace App\Controller;

use App\Dto\Auth\LoginDto;
use App\Dto\Auth\RegisterDto;
use App\Dto\Auth\UpdateMeDto;
use App\Security\CurrentUserResolver;
use App\Service\AuthService;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
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
    ) {}

    #[Route('/register', methods: ['POST'])]
    public function register(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), RegisterDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: ' . $e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        $result = $this->auth->register($dto->name, $dto->email, $dto->password);
        return new JsonResponse($result, Response::HTTP_CREATED);
    }

    #[Route('/login', methods: ['POST'])]
    public function login(Request $request): JsonResponse
    {
        try {
            $dto = $this->serializer->deserialize($request->getContent(), LoginDto::class, 'json');
        } catch (SerializerException $e) {
            throw new BadRequestHttpException('Invalid JSON body: ' . $e->getMessage(), $e);
        }
        $this->validateDto($dto, $this->validator);
        return new JsonResponse($this->auth->login($dto->email, $dto->password));
    }

    #[Route('/token', methods: ['POST'])]
    public function token(Request $request): JsonResponse
    {
        $grantType    = $request->request->get('grant_type');
        $refreshToken = $request->request->get('refresh_token');
        if ($grantType !== 'refresh_token' || empty($refreshToken)) {
            throw new BadRequestHttpException('Invalid grant type or missing refresh_token');
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
        if (array_key_exists('dateFormat', $data))     $dto->dateFormat     = $data['dateFormat'];
        if (array_key_exists('firstDayOfWeek', $data)) $dto->firstDayOfWeek = $data['firstDayOfWeek'];
        if (array_key_exists('lastClubId', $data))     $dto->lastClubId     = $data['lastClubId'];
        if (array_key_exists('lastCalendarId', $data)) $dto->lastCalendarId = $data['lastCalendarId'];
        $this->validateDto($dto, $this->validator);
        return new JsonResponse($this->auth->updateMe($user, $data));
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
        $all = [
            'google'    => ['name' => 'Google',    'icon' => 'google',    'envKey' => 'GOOGLE_CLIENT_ID',    'envSecret' => 'GOOGLE_CLIENT_SECRET'],
            'microsoft' => ['name' => 'Microsoft', 'icon' => 'microsoft', 'envKey' => 'MICROSOFT_CLIENT_ID', 'envSecret' => 'MICROSOFT_CLIENT_SECRET'],
            'apple'     => ['name' => 'Apple',     'icon' => 'apple',     'envKey' => 'APPLE_CLIENT_ID',     'envSecret' => 'APPLE_CLIENT_SECRET'],
        ];

        $enabled = [];
        foreach ($all as $id => $meta) {
            if (!empty($_ENV[$meta['envKey']]) && !empty($_ENV[$meta['envSecret']])) {
                $enabled[] = ['id' => $id, 'name' => $meta['name'], 'icon' => $meta['icon']];
            }
        }

        return new JsonResponse($enabled);
    }
}
