<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use App\Validator\PasswordPolicy;
use Symfony\Component\Validator\Constraints as Assert;

class RegisterDto
{
    #[Assert\NotBlank]
    #[Assert\Length(min: 1, max: 255)]
    public string $name = '';

    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    #[PasswordPolicy]
    public string $password = '';

    public ?string $language = null;

    /** @var array<mixed> ids of the legal documents the user accepts (checked by AuthService::register) */
    public array $acceptedDocuments = [];

    /** @var mixed optional {feedId, secret?}; parsed leniently by FeedProof::fromInput */
    public mixed $feedProof = null;
}
