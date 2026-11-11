<?php

declare(strict_types=1);

namespace App\Security;

use GeoIp2\Database\Reader;
use GeoIp2\Exception\AddressNotFoundException;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;

/** Offline lookup in a local GeoLite2/GeoIP2 City database; never contacts MaxMind at request time. */
final class MaxMindLocationResolver implements LocationResolver
{
    private ?Reader $reader = null;
    private bool $unavailable = false;

    public function __construct(
        #[Autowire('%env(GEOIP_DB_PATH)%')]
        private readonly string $databasePath,
        private readonly LoggerInterface $logger,
    ) {
    }

    public function resolve(Request $request): Location
    {
        $ip = $request->getClientIp();
        if (null === $ip || false === filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return new Location();
        }
        $reader = $this->reader();
        if (null === $reader) {
            return new Location();
        }

        try {
            $record = $reader->city($ip);
        } catch (AddressNotFoundException) {
            return new Location();
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP lookup failed', ['exception' => $e::class]);

            return new Location();
        }

        $lang = 'de' === $request->getPreferredLanguage(['en', 'de']) ? 'de' : 'en';
        $city = $record->city->names[$lang] ?? $record->city->names['en'] ?? null;

        return new Location($city, $record->country->isoCode);
    }

    private function reader(): ?Reader
    {
        if (null !== $this->reader || $this->unavailable) {
            return $this->reader;
        }
        try {
            $this->reader = new Reader($this->databasePath);
        } catch (\Throwable $e) {
            $this->unavailable = true;
            $this->logger->warning('GeoIP database unavailable (run app:geoip:update)', ['path' => $this->databasePath, 'exception' => $e::class]);
        }

        return $this->reader;
    }
}
