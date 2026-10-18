<?php

declare(strict_types=1);

namespace App\Security;

use Symfony\Component\DependencyInjection\EnvVarProcessorInterface;
use Symfony\Component\DependencyInjection\Exception\RuntimeException;

/**
 * `%env(trusted_hosts:TRUSTED_HOSTS)%` builds the `framework.trusted_hosts` regex (M2, Host header poisoning).
 *
 * Allowed hosts: the hosts of APP_URL, FRONTEND_URL and BACKEND_URL, the comma-separated extra hosts of the
 * given variable (e.g. a www alias) and always the loopback names (the container health check calls
 * http://127.0.0.1, local dev and the E2E setup use localhost). A forged `Host` header can therefore never
 * reach the application, and the links of mails and redirects come from the URL variables anyway.
 */
final class TrustedHostsEnvVarProcessor implements EnvVarProcessorInterface
{
    private const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

    public function getEnv(string $prefix, string $name, \Closure $getEnv): string
    {
        $hosts = self::LOOPBACK;
        foreach (['APP_URL', 'FRONTEND_URL', 'BACKEND_URL'] as $variable) {
            $url = (string) $getEnv($variable);
            $host = parse_url($url, PHP_URL_HOST);
            if (!is_string($host) || '' === $host) {
                throw new RuntimeException(sprintf('%s must be an absolute URL with a host, got "%s".', $variable, $url));
            }
            $hosts[] = $host;
        }
        foreach (explode(',', (string) $getEnv($name)) as $extra) {
            $extra = trim($extra);
            if ('' !== $extra) {
                $hosts[] = $extra;
            }
        }

        $quoted = array_map(static fn (string $host): string => preg_quote(strtolower($host), '{'), array_unique($hosts));

        return '^(?:'.implode('|', $quoted).')$';
    }

    public static function getProvidedTypes(): array
    {
        return ['trusted_hosts' => 'string'];
    }
}
