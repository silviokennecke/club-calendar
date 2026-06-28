<?php

declare(strict_types=1);

namespace App\Dto;

use Symfony\Component\Validator\Exception\ValidationFailedException;
use Symfony\Component\Validator\Validator\ValidatorInterface;

trait ValidationTrait
{
    private function validate(object $dto, ValidatorInterface $validator): void
    {
        $violations = $validator->validate($dto);
        if (count($violations) > 0) {
            throw new ValidationFailedException($dto, $violations);
        }
    }
}
