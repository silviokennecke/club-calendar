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
 *
 * `%env(trusted_host_list:TRUSTED_HOSTS)%` returns the same hosts as a list (MCP `http.allowed_hosts`).
 */
final class TrustedHostsEnvVarProcessor implements EnvVarProcessorInterface
{
    private const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

    public function getEnv(string $prefix, string $name, \Closure $getEnv): string|array
    {
        $hosts = $this->hosts($name, $getEnv);
        if ('trusted_host_list' === $prefix) {
            return $hosts;
        }

        $quoted = array_map(static fn (string $host): string => preg_quote($host, '{'), $hosts);

        return '^(?:'.implode('|', $quoted).')$';
    }

    /** @return list<string> lower-case host names without port */
    private function hosts(string $name, \Closure $getEnv): array
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

        return array_values(array_unique(array_map('strtolower', $hosts)));
    }

    public static function getProvidedTypes(): array
    {
        return ['trusted_hosts' => 'string', 'trusted_host_list' => 'array'];
    }
}
