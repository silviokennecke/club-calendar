<?php

declare(strict_types=1);

namespace App\Entity;

interface UpdateAudited
{
    public function getUpdatedAt(): \DateTimeImmutable;

    public function getUpdatedBy(): ?User;

    public function stampUpdate(\DateTimeImmutable $at, ?User $by): void;
}
