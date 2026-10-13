<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\ValidationTrait;
use App\Exception\ApiProblemException;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Validator\Validator\ValidatorInterface;

abstract class AbstractApiController extends AbstractController
{
    use ValidationTrait;

    protected function validateDto(object $dto, ValidatorInterface $validator): void
    {
        $this->validate($dto, $validator);
    }

    protected function decodeJson(Request $request): array
    {
        $data = json_decode($request->getContent(), true);
        if (!is_array($data)) {
            throw self::invalidJson('Invalid JSON body');
        }

        return $data;
    }

    /** 400 `code: invalid_request`: the body is no JSON object (or not of the expected shape). */
    protected static function invalidJson(string $message, ?\Throwable $previous = null): ApiProblemException
    {
        return new ApiProblemException(400, $message, 'invalid_request', null, [], $previous);
    }
}
