<?php

declare(strict_types=1);

namespace App\Security;

use App\Service\GeoIpDatabase;
use GeoIp2\Database\Reader;
use GeoIp2\Exception\AddressNotFoundException;
use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\Request;

/** Offline lookup in a local GeoLite2/GeoIP2 City database; never contacts MaxMind at request time. */
final class MaxMindLocationResolver implements LocationResolver
{
    private ?Reader $reader = null;
    private ?string $readerPath = null;

    public function __construct(
        private readonly GeoIpDatabase $database,
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

    /** Re-opens the Reader when the local copy was replaced; the old one stays valid until closed here. */
    private function reader(): ?Reader
    {
        try {
            $path = $this->database->localPath();
            if (null === $path) {
                $this->logger->warning('GeoIP database unavailable (run app:geoip:update)');

                return $this->reader;
            }
            if ($path !== $this->readerPath) {
                $new = new Reader($path);
                $old = $this->reader;
                $this->reader = $new;
                $this->readerPath = $path;
                $old?->close();
            }
        } catch (\Throwable $e) {
            $this->logger->warning('GeoIP database unusable', ['exception' => $e::class]);
        }

        return $this->reader;
    }
}
