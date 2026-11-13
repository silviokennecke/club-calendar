<?php

declare(strict_types=1);

namespace App\Twig;

use App\Service\AppBranding;
use Twig\Extension\AbstractExtension;
use Twig\Extension\GlobalsInterface;

/** `app_name` (the instance name) for the e-mail header and footer, available in every template. */
final class AppNameExtension extends AbstractExtension implements GlobalsInterface
{
    public function __construct(private readonly AppBranding $branding)
    {
    }

    public function getGlobals(): array
    {
        return ['app_name' => $this->branding->name()];
    }
}
