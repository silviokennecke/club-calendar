<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

class IdentifyDto
{
    #[Assert\NotBlank]
    #[Assert\Email]
    #[Assert\Length(max: 254)]
    public string $email = '';

    /** @var mixed optional {feedId, secret?}; parsed leniently by FeedProof::fromInput */
    public mixed $feedProof = null;
}
