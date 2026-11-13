<?php

declare(strict_types=1);

namespace App\Service;

use Symfony\Component\DependencyInjection\Attribute\Autowire;

/** The operator-configurable instance name (`APP_NAME`); the product name stays fixed. */
class AppBranding
{
    public const string PROJECT_NAME = 'Club Calendar';
    public const int MAX_LENGTH = 60;

    public function __construct(
        #[Autowire(env: 'APP_NAME')]
        private readonly string $configuredName = self::PROJECT_NAME,
    ) {
    }

    public function name(): string
    {
        return self::sanitize($this->configuredName);
    }

    public static function sanitize(string $value): string
    {
        $value = trim((string) preg_replace('/[\p{Cc}\p{Cf}]+/u', '', $value));
        $value = trim(mb_substr($value, 0, self::MAX_LENGTH));

        return '' === $value ? self::PROJECT_NAME : $value;
    }
}
