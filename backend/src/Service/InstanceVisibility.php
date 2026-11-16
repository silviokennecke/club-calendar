<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** Single source for the instance-wide indexing policy (env INSTANCE_PRIVATE, default true). */
class InstanceVisibility
{
    public function __construct(
        #[Autowire('%env(bool:INSTANCE_PRIVATE)%')]
        private readonly bool $private,
    ) {
    }

    public function isPrivate(): bool
    {
        return $this->private;
    }
}
