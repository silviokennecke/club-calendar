<?php

declare(strict_types=1);

namespace App\OAuth;

enum McpScope: string
{
    case Read = 'mcp:read';
    case Write = 'mcp:write';

    /**
     * Parses a space-separated scope string into the canonical list (write implies read, fixed order, no
     * duplicates). Null for an empty string or any unknown scope.
     *
     * @return list<self>|null
     */
    public static function parse(string $scope): ?array
    {
        $found = [];
        foreach (preg_split('/ +/', trim($scope), -1, PREG_SPLIT_NO_EMPTY) ?: [] as $part) {
            $s = self::tryFrom($part);
            if (null === $s) {
                return null;
            }
            $found[$s->value] = $s;
        }
        if ([] === $found) {
            return null;
        }
        if (isset($found[self::Write->value])) {
            $found[self::Read->value] = self::Read;
        }

        return array_values(array_filter(self::cases(), static fn (self $c) => isset($found[$c->value])));
    }

    /** @param list<self> $scopes */
    public static function toString(array $scopes): string
    {
        return implode(' ', array_map(static fn (self $s) => $s->value, $scopes));
    }

    /** @param list<self> $granted */
    public static function allows(array $granted, self $needed): bool
    {
        return in_array($needed, $granted, true) || (self::Read === $needed && in_array(self::Write, $granted, true));
    }
}
