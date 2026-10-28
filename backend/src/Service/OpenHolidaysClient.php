<?php

declare(strict_types=1);

namespace App\Service;

use Psr\Cache\CacheItemPoolInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/** Thin client for https://openholidaysapi.org (public and school holidays); lists are cached for 7 days. */
readonly class OpenHolidaysClient
{
    public const BASE_URL = 'https://openholidaysapi.org';
    public const MAX_BYTES = 5_242_880;
    public const KIND_PUBLIC = 'public';
    public const KIND_SCHOOL = 'school';

    public function __construct(
        private HttpClientInterface $httpClient,
        private CacheItemPoolInterface $cache,
    ) {
    }

    /** @return list<array{isoCode: string, name: string}> */
    public function countries(string $language): array
    {
        return $this->cached('countries.'.$language, function () use ($language): array {
            $out = [];
            foreach ($this->get('/Countries', ['languageIsoCode' => strtoupper($language)]) as $c) {
                if (is_array($c) && is_string($c['isoCode'] ?? null)) {
                    $out[] = ['isoCode' => $c['isoCode'], 'name' => self::localized($c['name'] ?? [], $language) ?? $c['isoCode']];
                }
            }

            return $out;
        });
    }

    /** @return list<array{code: string, name: string, children: list<array{code: string, name: string}>}> */
    public function subdivisions(string $country, string $language): array
    {
        return $this->cached('subdivisions.'.$country.'.'.$language, function () use ($country, $language): array {
            $rows = $this->get('/Subdivisions', ['countryIsoCode' => $country, 'languageIsoCode' => strtoupper($language)]);

            return self::mapSubdivisions($rows, $language);
        });
    }

    /**
     * One request for the whole window.
     *
     * @return list<array{id: string, name: string, start: string, end: string}>
     */
    public function holidays(string $kind, string $country, ?string $subdivision, \DateTimeImmutable $from, \DateTimeImmutable $to, string $language): array
    {
        $path = self::KIND_SCHOOL === $kind ? '/SchoolHolidays' : '/PublicHolidays';
        $query = [
            'countryIsoCode' => $country,
            'validFrom' => $from->format('Y-m-d'),
            'validTo' => $to->format('Y-m-d'),
            'languageIsoCode' => strtoupper($language),
        ];
        if (null !== $subdivision && '' !== $subdivision) {
            $query['subdivisionCode'] = $subdivision;
        }

        $out = [];
        foreach ($this->get($path, $query) as $h) {
            if (!is_array($h) || !is_string($h['startDate'] ?? null)) {
                continue;
            }
            $start = $h['startDate'];
            $end = is_string($h['endDate'] ?? null) ? $h['endDate'] : $start;
            $name = self::localized($h['name'] ?? [], $language) ?? '';
            $id = is_string($h['id'] ?? null) && '' !== $h['id'] ? $h['id'] : sha1($kind.$start.$name);
            $out[] = ['id' => $id, 'name' => $name, 'start' => $start, 'end' => $end];
        }

        return $out;
    }

    /** @return list<array<string, mixed>> */
    private function get(string $path, array $query): array
    {
        try {
            $response = $this->httpClient->request('GET', self::BASE_URL.$path, [
                'query' => $query,
                'headers' => ['Accept' => 'application/json'],
                'max_duration' => 15,
                'on_progress' => static function (int $downloaded): void {
                    if ($downloaded > self::MAX_BYTES) {
                        throw new \RuntimeException('OpenHolidays response too large');
                    }
                },
            ]);
            $data = json_decode($response->getContent(), true, 16, JSON_THROW_ON_ERROR);
        } catch (\Throwable $e) {
            throw new OpenHolidaysException('OpenHolidays request failed: '.$e->getMessage(), 0, $e);
        }
        if (!is_array($data)) {
            throw new OpenHolidaysException('OpenHolidays returned an unexpected payload');
        }

        return array_values($data);
    }

    private function cached(string $key, callable $load): array
    {
        $item = $this->cache->getItem('oh_'.sha1($key));
        if ($item->isHit()) {
            return $item->get();
        }
        $value = $load();
        $item->set($value);
        $this->cache->save($item);

        return $value;
    }

    private static function mapSubdivisions(array $rows, string $language): array
    {
        $out = [];
        foreach ($rows as $r) {
            if (!is_array($r) || !is_string($r['code'] ?? null)) {
                continue;
            }
            $out[] = [
                'code' => $r['code'],
                'name' => self::localized($r['name'] ?? [], $language) ?? $r['code'],
                'children' => self::mapSubdivisions(is_array($r['children'] ?? null) ? $r['children'] : [], $language),
            ];
        }

        return $out;
    }

    /** The entry of the requested language, else the first one. */
    private static function localized(mixed $names, string $language): ?string
    {
        if (!is_array($names)) {
            return null;
        }
        $first = null;
        foreach ($names as $n) {
            if (!is_array($n) || !is_string($n['text'] ?? null)) {
                continue;
            }
            if (strtolower((string) ($n['language'] ?? '')) === strtolower($language)) {
                return $n['text'];
            }
            $first ??= $n['text'];
        }

        return $first;
    }
}
