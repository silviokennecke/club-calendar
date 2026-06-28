<?php

declare(strict_types=1);

namespace App\Controller;

use App\Dto\ValidationTrait;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
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
            throw new BadRequestHttpException('Invalid JSON body');
        }

        return $data;
    }
}
