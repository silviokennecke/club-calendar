<?php

declare(strict_types=1);

namespace App\Security;

use UAParser\Parser;

final class UserAgentSummary
{
    private static ?Parser $parser = null;

    /** "Chrome 126" (family and major version, at most 20 characters of A-Z a-z 0-9 space . - _) or null when unknown. */
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

        // Rules of uap-core copy free text of the header into the family: only inert characters, max. 20.
        return ClientContextSanitizer::browserWithVersion($family, $ua->major);
    }
}
