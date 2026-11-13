<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\AsDecorator;
use Symfony\Component\DependencyInjection\Attribute\AutowireDecorated;
use Symfony\Component\Translation\TranslatorBagInterface;
use Symfony\Contracts\Translation\LocaleAwareInterface;
use Symfony\Contracts\Translation\TranslatorInterface;

/** Supplies `{appName}` (the instance name, {@see AppBranding}) to every translation, so callers need not pass it. */
#[AsDecorator('translator')]
final class BrandingTranslator implements TranslatorInterface, LocaleAwareInterface, TranslatorBagInterface
{
    public function __construct(
        #[AutowireDecorated]
        private readonly TranslatorInterface&LocaleAwareInterface&TranslatorBagInterface $inner,
        private readonly AppBranding $branding,
    ) {
    }

    public function trans(string $id, array $parameters = [], ?string $domain = null, ?string $locale = null): string
    {
        $parameters += ['appName' => $this->branding->name()];

        return $this->inner->trans($id, $parameters, $domain, $locale);
    }

    public function getLocale(): string
    {
        return $this->inner->getLocale();
    }

    public function setLocale(string $locale): void
    {
        $this->inner->setLocale($locale);
    }

    public function getCatalogue(?string $locale = null): \Symfony\Component\Translation\MessageCatalogueInterface
    {
        return $this->inner->getCatalogue($locale);
    }

    public function getCatalogues(): array
    {
        return $this->inner->getCatalogues();
    }
}
