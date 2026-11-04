<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Event;
use App\Entity\Location;
use App\Exception\ApiProblemException;
use App\Exception\RateLimitExceededException;
use App\Security\AuthRateLimiter;
use App\Service\Map\MapAvailability;
use App\Service\Map\MapImageProviderInterface;
use Doctrine\ORM\EntityManagerInterface;
use Geocoder\Location as GeocodedLocation;
use Geocoder\Provider\Provider;
use Geocoder\Query\GeocodeQuery;
use Geocoder\Query\ReverseQuery;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/api/map')]
class MapController extends AbstractController
{
    public function __construct(
        private readonly Provider $geocoder,
        private readonly MapImageProviderInterface $mapImageProvider,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
        private readonly MapAvailability $mapAvailability,
        private readonly AuthRateLimiter $rateLimiter,
        private readonly int $imageZoom,
        private readonly int $imageWidth,
        private readonly int $imageHeight,
    ) {
    }

    #[Route('/geocode/suggest', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function suggest(Request $request): Response
    {
        $this->assertMapAvailable();
        $query = trim((string) $request->query->get('q', ''));
        if ('' === $query) {
            return $this->json(['suggestions' => []]);
        }

        $limit = max(1, min(10, (int) $request->query->get('limit', 6)));

        try {
            $results = $this->geocoder->geocodeQuery(GeocodeQuery::create($query)->withLimit($limit));
        } catch (RateLimitExceededException) {
            throw self::rateLimited();
        } catch (\Throwable $e) {
            $this->logger->error('Geocoding suggest failed', ['exception' => $e]);
            throw new ServiceUnavailableHttpException(null, 'Geocoding service unavailable', $e);
        }

        $suggestions = [];
        foreach ($results as $location) {
            $coordinates = $location->getCoordinates();
            if (null === $coordinates) {
                continue;
            }
            $address = self::address($location);
            $suggestions[] = [
                'label' => $address['label'],
                'lat' => $coordinates->getLatitude(),
                'lng' => $coordinates->getLongitude(),
            ] + $address;
        }

        return $this->json(['suggestions' => $suggestions]);
    }

    #[Route('/geocode/reverse', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function reverse(Request $request): Response
    {
        $this->assertMapAvailable();
        $lat = (float) $request->query->get('lat', 0);
        $lng = (float) $request->query->get('lng', 0);

        try {
            $results = $this->geocoder->reverseQuery(ReverseQuery::fromCoordinates($lat, $lng));
        } catch (RateLimitExceededException) {
            throw self::rateLimited();
        } catch (\Throwable $e) {
            $this->logger->error('Geocoding reverse failed', ['exception' => $e]);
            throw new ServiceUnavailableHttpException(null, 'Geocoding service unavailable', $e);
        }

        if ($results->isEmpty()) {
            throw new NotFoundHttpException('No address found for the given coordinates');
        }

        return $this->json(self::address($results->first()));
    }

    #[Route('/image/location/{id}', methods: ['GET'])]
    public function locationImage(string $id, Request $request): Response
    {
        $this->rateLimiter->assertMapImageAllowed($request);
        $location = $this->em->find(Location::class, $id);
        if (null === $location || null === $location->getLatitude() || null === $location->getLongitude()) {
            throw new NotFoundHttpException('Location not found or has no coordinates');
        }

        return $this->buildImageResponse($request, $location->getLongitude(), $location->getLatitude(), '' !== trim((string) $request->query->get('v', '')));
    }

    #[Route('/image/event/{id}', methods: ['GET'])]
    public function eventImage(string $id, Request $request): Response
    {
        $this->rateLimiter->assertMapImageAllowed($request);
        $event = $this->em->find(Event::class, $id);
        // Public endpoint: drafts are not published anywhere, so their location is not either
        $location = null !== $event && !$event->isDraft() ? $event->getLocation() : null;
        if (null === $location || null === $location->getLatitude() || null === $location->getLongitude()) {
            throw new NotFoundHttpException('Event not found or has no location with coordinates');
        }

        return $this->buildImageResponse($request, $location->getLongitude(), $location->getLatitude(), false);
    }

    /** @return array{label: string, street: ?string, zip: ?string, city: ?string, country: ?string} */
    private static function address(GeocodedLocation $location): array
    {
        $name = $location->getStreetName();
        $street = null === $name ? null : trim($name.' '.$location->getStreetNumber());
        $zip = $location->getPostalCode();
        $city = $location->getLocality();
        $country = $location->getCountry()?->getName();
        $label = implode(', ', array_filter(
            [$street, trim(($zip ?? '').' '.($city ?? '')), $country],
            static fn (?string $p): bool => null !== $p && '' !== $p,
        ));

        return ['label' => $label, 'street' => $street, 'zip' => $zip, 'city' => $city, 'country' => $country];
    }

    /** 429 `rate_limited` (RFC 7807) of the JSON routes (geocoding, Mapbox proxy); map images answer an empty 429. */
    public static function rateLimited(): ApiProblemException
    {
        return new ApiProblemException(429, 'Too many requests', 'rate_limited');
    }

    /**
     * Only called after the access checks of the route (unknown / draft / without position → 404), so the
     * placeholder reveals nothing about places or events.
     *
     * $versioned: the URL carries a cache-buster (`v`) that changes with the location, so the image may be cached
     * for the full provider TTL and treated as immutable.
     */
    private function buildImageResponse(Request $request, float $lng, float $lat, bool $versioned): Response
    {
        if (!$this->mapAvailability->isConfigured()) {
            // 503 with an image body: an <img> still shows a (blurred, text-free) map.
            return new Response((string) file_get_contents(MapAvailability::PLACEHOLDER_IMAGE), 503, [
                'Content-Type' => 'image/png',
                'Cache-Control' => 'no-store',
            ]);
        }

        try {
            $bytes = $this->mapImageProvider->getImage($lng, $lat, $this->imageZoom, $this->imageWidth, $this->imageHeight);
        } catch (RateLimitExceededException) {
            return new Response(null, 429, ['Cache-Control' => 'no-store']);
        }

        $response = new Response($bytes, 200, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => $versioned
                ? 'public, max-age=2592000, s-maxage=2592000, immutable'
                : 'public, max-age=86400, s-maxage=86400',
        ]);
        $response->setEtag(hash('sha256', $bytes));
        $response->isNotModified($request);

        return $response;
    }

    /** JSON routes without a configured map service: 503 `code: map_unavailable`. */
    private function assertMapAvailable(): void
    {
        if (!$this->mapAvailability->isConfigured()) {
            throw MapAvailability::unavailable();
        }
    }
}
