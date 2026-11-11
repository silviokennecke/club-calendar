<?php

declare(strict_types=1);

namespace App\Security;

use UAParser\Parser;

final class UserAgentSummary
{
    private static ?Parser $parser = null;

    /** "Chrome 126" (family and major version) or null when the browser is unknown. */
    public static function browser(string $userAgent): ?string
    {
        if ('' === trim($userAgent)) {
            return null;
        }

        // Built once per process from the pre-converted resources/regexes.php (no YAML parsing).
        $ua = (self::$parser ??= Parser::create())->parse($userAgent)->ua;
        $family = $ua->family;
        if ('' === $family || 'Other' === $family) {
            return null;
        }

        return null !== $ua->major && '' !== $ua->major ? $family.' '.$ua->major : $family;
    }
}
