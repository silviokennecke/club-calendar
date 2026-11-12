<?php

declare(strict_types=1);

namespace App\Security;

use UAParser\Parser;

final class UserAgentSummary
{
    private static ?Parser $parser = null;

    /** "Chrome 126": a known browser name (allow-list) and a numeric major version, null for anything else. */
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

        // uap-core rules copy free text of the header into the family: only allow-listed names pass.
        return ClientContextSanitizer::knownBrowser($family, $ua->major);
    }
}
