<?php

declare(strict_types=1);

namespace App\Command;

use App\Security\ClientContextResolver;
use App\Security\LocationResolver;
use App\Security\MaxMindLocationResolver;
use Symfony\Component\Console\Attribute\Argument;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Attribute\Option;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Style\SymfonyStyle;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Operator diagnosis: runs a synthetic request (REMOTE_ADDR = the given IP plus the given headers) through the same
 * ClientContextResolver the app uses and explains the result. Read-only: no database access, no mail, no security event.
 */
#[AsCommand(name: 'app:geoip:debug', description: 'Show how the location of a client IP (and proxy headers) is detected')]
class GeoIpDebugCommand
{
    public function __construct(
        private readonly ClientContextResolver $contextResolver,
        private readonly LocationResolver $locationResolver,
        private readonly RequestStack $requestStack,
        #[Autowire('%env(MAXMIND_LICENSE_KEY)%')]
        private readonly string $licenseKey,
        #[Autowire('%env(GEOIP_DB_PATH)%')]
        private readonly string $databasePath,
        #[Autowire('%env(CLIENT_COUNTRY_HEADER)%')]
        private readonly string $countryHeader,
    ) {
    }

    /** @param list<string> $header */
    public function __invoke(
        SymfonyStyle $io,
        #[Argument('Client IP (REMOTE_ADDR of the simulated request)')] string $ip,
        #[Option('Request header, curl style "Name: value" (repeatable)', name: 'header', shortcut: 'H')] array $header = [],
    ): int {
        if (false === filter_var($ip, FILTER_VALIDATE_IP)) {
            $io->error(sprintf('"%s" is not a valid IP address.', $ip));

            return Command::FAILURE;
        }
        try {
            $headers = self::parseHeaders($header);
        } catch (\InvalidArgumentException $e) {
            $io->error($e->getMessage());

            return Command::FAILURE;
        }

        $server = ['REMOTE_ADDR' => $ip];
        foreach ($headers as $name => $value) {
            $server['HTTP_'.strtoupper(str_replace('-', '_', $name))] = $value;
        }
        $request = Request::create('/', 'GET', [], [], [], $server);

        $this->requestStack->push($request);
        try {
            $context = $this->contextResolver->current();
        } finally {
            $this->requestStack->pop();
        }

        $maxMind = $this->locationResolver instanceof MaxMindLocationResolver;
        $trusted = $request->isFromTrustedProxy();
        $proxies = Request::getTrustedProxies();

        $io->title('Location detection');
        $io->section('Configuration');
        $io->definitionList(
            ['Active resolver' => $maxMind ? 'MaxMind GeoLite2 (MAXMIND_LICENSE_KEY is set)' : 'Proxy country header (MAXMIND_LICENSE_KEY is not set)'],
            ['MAXMIND_LICENSE_KEY' => '' !== trim($this->licenseKey) ? 'set' : 'not set'],
            ['GEOIP_DB_PATH' => $this->databasePath.' ('.self::fileInfo($this->databasePath).')'],
            ['CLIENT_COUNTRY_HEADER' => '' === $this->countryHeader ? '(empty: off)' : $this->countryHeader],
            ['Trusted proxies' => [] === $proxies ? '(none: SYMFONY_TRUSTED_PROXIES is empty)' : implode(', ', $proxies)],
        );

        $io->section('Simulated request');
        $sent = [];
        foreach ($headers as $name => $value) {
            $sent[] = $name.': '.$value;
        }
        $io->definitionList(
            ['REMOTE_ADDR' => $ip],
            ['Is a trusted proxy' => $trusted ? 'yes' : 'no'],
            ['Headers' => [] === $sent ? '(none)' : implode("\n", $sent)],
            ['Client IP as the app sees it' => $context->ip ?? '(none)'],
        );

        $io->section('Result');
        $io->definitionList(
            ['City' => $context->city ?? '-'],
            ['Country' => $context->country ?? '-'],
        );
        if (null !== $context->city || null !== $context->country) {
            $io->success('Location found.');

            return Command::SUCCESS;
        }

        $io->warning('Nothing found: '.$this->reason($maxMind, $request, $context->ip, $trusted, $proxies));

        return Command::SUCCESS;
    }

    /**
     * @param list<string> $lines
     *
     * @return array<string, string>
     */
    public static function parseHeaders(array $lines): array
    {
        $headers = [];
        foreach ($lines as $line) {
            $pos = strpos($line, ':');
            $name = false === $pos ? '' : trim(substr($line, 0, $pos));
            if ('' === $name || 1 !== preg_match('/^[A-Za-z0-9-]+$/', $name)) {
                throw new \InvalidArgumentException(sprintf('Invalid header "%s": use "Name: value".', $line));
            }
            $headers[$name] = trim(substr($line, $pos + 1));
        }

        return $headers;
    }

    /** @param list<string> $proxies */
    private function reason(bool $maxMind, Request $request, ?string $clientIp, bool $trusted, array $proxies): string
    {
        if ($maxMind) {
            if (null === $clientIp || false === filter_var($clientIp, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                return sprintf('the client IP %s is private or reserved and has no location.', $clientIp ?? '(none)');
            }
            if (!is_file($this->databasePath) || !is_readable($this->databasePath)) {
                return 'the database file is missing or not readable (run app:geoip:update).';
            }

            return 'the IP is not in the database, or the file is not a valid City database (see the log).';
        }

        if ('' === $this->countryHeader) {
            return 'CLIENT_COUNTRY_HEADER is empty, so no country is read without a MaxMind key.';
        }
        if (!$trusted) {
            return [] === $proxies
                ? 'the header is ignored because no trusted proxies are configured (SYMFONY_TRUSTED_PROXIES).'
                : sprintf('the header is ignored because %s is not one of the trusted proxies.', $request->server->get('REMOTE_ADDR'));
        }
        if (!$request->headers->has($this->countryHeader)) {
            return sprintf('the request has no "%s" header.', $this->countryHeader);
        }

        return sprintf('the header value "%s" is not a usable country code (two letters; XX and T1 are ignored).', (string) $request->headers->get($this->countryHeader));
    }

    private static function fileInfo(string $path): string
    {
        if (!is_file($path)) {
            return 'file does not exist';
        }
        if (!is_readable($path)) {
            return 'exists but is not readable';
        }

        return sprintf('%s bytes, modified %s', number_format((int) filesize($path), 0, '.', ','), date('Y-m-d H:i:s', (int) filemtime($path)));
    }
}
