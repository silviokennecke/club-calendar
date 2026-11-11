<?php

declare(strict_types=1);

namespace App\Security;

final class UserAgentSummary
{
    /** Ordered: Edge/Opera/Samsung contain "Chrome", Chrome contains "Safari". */
    private const PATTERNS = [
        'Edge' => '#\bEdg(?:e|A|iOS)?/(\d+)#',
        'Opera' => '#\bOPR/(\d+)#',
        'Samsung Internet' => '#\bSamsungBrowser/(\d+)#',
        'Firefox' => '#\b(?:Firefox|FxiOS)/(\d+)#',
        'Chrome' => '#\b(?:Chrome|CriOS)/(\d+)#',
        'Safari' => '#\bVersion/(\d+)[^ ]*(?: Mobile/\S+)? Safari/#',
    ];

    public static function browser(string $userAgent): ?string
    {
        foreach (self::PATTERNS as $name => $regex) {
            if (preg_match($regex, $userAgent, $m)) {
                return $name.' '.$m[1];
            }
        }

        return null;
    }
}
