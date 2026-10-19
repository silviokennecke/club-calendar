<?php

declare(strict_types=1);

namespace App\Enum;

/** Legal documents of the app. Privacy policy and terms of use need the user's consent, the imprint never. */
enum LegalDocumentType: string
{
    case IMPRINT = 'imprint';
    case PRIVACY = 'privacy';
    case TERMS = 'terms';

    public function requiresConsent(): bool
    {
        return self::IMPRINT !== $this;
    }

    /** @return list<self> */
    public static function consentTypes(): array
    {
        return array_values(array_filter(self::cases(), static fn (self $t): bool => $t->requiresConsent()));
    }

    /** Name of the Markdown source file in the legal documents directory. */
    public function fileName(): string
    {
        return $this->value.'.md';
    }
}
