<?php

declare(strict_types=1);

namespace App\Dto\Auth;

use Symfony\Component\Validator\Constraints as Assert;

/** Exactly one of registrationState (signup), resetToken, reauthTicket (change password), upgradeTicket selects the context. */
class OpaqueRegisterFinishDto
{
    #[Assert\Length(max: 2048)]
    public ?string $registrationState = null;

    #[Assert\Length(max: 255)]
    public ?string $resetToken = null;

    #[Assert\Length(max: 2048)]
    public ?string $reauthTicket = null;

    #[Assert\Length(max: 2048)]
    public ?string $upgradeTicket = null;

    /** Registration record (192 bytes) as base64url */
    #[Assert\NotBlank]
    #[Assert\Length(max: 512)]
    public string $registrationRecord = '';

    /** Signup only */
    #[Assert\Length(max: 255)]
    public ?string $name = null;

    /** Signup only */
    public ?string $language = null;

    /** @var array<mixed> signup only: ids of the legal documents the user accepts */
    public array $acceptedDocuments = [];
}
