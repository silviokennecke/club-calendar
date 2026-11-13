<?php

declare(strict_types=1);

namespace App\Service;

use GeoIp2\Database\Reader;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/** Downloads the GeoLite2 City database from MaxMind and replaces the local file atomically. */
class GeoIpUpdater
{
    public const string URL = 'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz';
    private const int MIN_AGE = 3 * 86400;

    public function __construct(
        private readonly HttpClientInterface $httpClient,
        #[Autowire('%env(MAXMIND_ACCOUNT_ID)%')]
        private readonly string $accountId,
        #[Autowire('%env(MAXMIND_LICENSE_KEY)%')]
        private readonly string $licenseKey,
        #[Autowire('%env(GEOIP_DB_PATH)%')]
        private readonly string $databasePath,
    ) {
    }

    public function update(bool $force = false): GeoIpUpdateResult
    {
        if ('' === trim($this->licenseKey)) {
            return new GeoIpUpdateResult(GeoIpUpdateStatus::NotConfigured, 'MAXMIND_LICENSE_KEY is not set: nothing to do.');
        }
        if ('' === trim($this->accountId)) {
            return new GeoIpUpdateResult(GeoIpUpdateStatus::Failed, 'MAXMIND_ACCOUNT_ID is not set.');
        }
        if (!$force && is_file($this->databasePath) && time() - (int) filemtime($this->databasePath) < self::MIN_AGE) {
            return new GeoIpUpdateResult(GeoIpUpdateStatus::Skipped, 'The database is younger than 3 days: skipped (use --force).');
        }

        $dir = dirname($this->databasePath);
        if (!is_dir($dir) && !@mkdir($dir, 0775, true) && !is_dir($dir)) {
            return new GeoIpUpdateResult(GeoIpUpdateStatus::Failed, sprintf('Cannot create %s.', $dir));
        }

        $archive = $this->databasePath.'.'.bin2hex(random_bytes(4)).'.tar.gz';
        $tmpDb = $this->databasePath.'.'.bin2hex(random_bytes(4)).'.tmp';
        try {
            $this->download($archive);
            $this->extract($archive, $tmpDb);
            $this->validate($tmpDb);
            if (!rename($tmpDb, $this->databasePath)) {
                throw new \RuntimeException('Cannot replace the database file.');
            }
        } catch (\Throwable $e) {
            return new GeoIpUpdateResult(GeoIpUpdateStatus::Failed, 'GeoIP update failed, the old file is kept: '.$e->getMessage(), $e);
        } finally {
            @unlink($archive);
            @unlink($tmpDb);
            // PharData creates a sibling .tar for a .tar.gz
            @unlink(substr($archive, 0, -3));
        }

        return new GeoIpUpdateResult(GeoIpUpdateStatus::Updated, 'GeoLite2 City database updated.');
    }

    private function download(string $target): void
    {
        $response = $this->httpClient->request('GET', self::URL, [
            'auth_basic' => [$this->accountId, $this->licenseKey],
            'timeout' => 30,
            'max_duration' => 300,
        ]);
        if (200 !== $response->getStatusCode()) {
            throw new \RuntimeException(sprintf('MaxMind answered HTTP %d.', $response->getStatusCode()));
        }
        $handle = fopen($target, 'wb');
        if (false === $handle) {
            throw new \RuntimeException('Cannot write the download.');
        }
        try {
            foreach ($this->httpClient->stream($response) as $chunk) {
                fwrite($handle, $chunk->getContent());
            }
        } finally {
            fclose($handle);
        }
    }

    private function extract(string $archive, string $target): void
    {
        $phar = new \PharData($archive);
        $source = null;
        foreach (new \RecursiveIteratorIterator($phar) as $file) {
            if (str_ends_with((string) $file->getPathname(), '.mmdb')) {
                $source = $file;
                break;
            }
        }
        if (null === $source) {
            throw new \RuntimeException('The archive contains no .mmdb file.');
        }
        $in = fopen($source->getPathname(), 'rb');
        $out = fopen($target, 'wb');
        if (false === $in || false === $out || false === stream_copy_to_stream($in, $out)) {
            throw new \RuntimeException('Cannot extract the database.');
        }
        fclose($in);
        fclose($out);
    }

    private function validate(string $path): void
    {
        $reader = new Reader($path);
        try {
            if (!str_contains($reader->metadata()->databaseType, 'City')) {
                throw new \RuntimeException('Not a City database.');
            }
            try {
                $reader->city('8.8.8.8');
            } catch (\GeoIp2\Exception\AddressNotFoundException) {
            }
        } finally {
            $reader->close();
        }
    }
}
