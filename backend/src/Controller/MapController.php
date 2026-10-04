<?php

declare(strict_types=1);

namespace App\Controller;

use App\Entity\Event;
use App\Entity\Location;
use App\Exception\RateLimitExceededException;
use App\Service\Map\GeocoderInterface;
use App\Service\Map\MapImageProviderInterface;
use Doctrine\ORM\EntityManagerInterface;
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
        private readonly GeocoderInterface $geocoder,
        private readonly MapImageProviderInterface $mapImageProvider,
        private readonly EntityManagerInterface $em,
        private readonly LoggerInterface $logger,
        private readonly int $imageZoom,
        private readonly int $imageWidth,
        private readonly int $imageHeight,
    ) {
    }

    #[Route('/geocode/suggest', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function suggest(Request $request): Response
    {
        $query = trim((string) $request->query->get('q', ''));
        if ('' === $query) {
            return $this->json(['suggestions' => []]);
        }

        $lat = $request->query->has('lat') ? (float) $request->query->get('lat') : null;
        $lng = $request->query->has('lng') ? (float) $request->query->get('lng') : null;
        $limit = max(1, min(10, (int) $request->query->get('limit', 6)));

        try {
            $results = $this->geocoder->suggest($query, $lat, $lng, $limit);
        } catch (RateLimitExceededException) {
            return new Response(null, 429);
        } catch (\Throwable $e) {
            $this->logger->error('Geocoding suggest failed', ['exception' => $e]);
            throw new ServiceUnavailableHttpException(null, 'Geocoding service unavailable', $e);
        }

        return $this->json([
            'suggestions' => array_map(fn ($r) => [
                'label' => $r->label,
                'lat' => $r->lat,
                'lng' => $r->lng,
                'street' => $r->street,
                'zip' => $r->zip,
                'city' => $r->city,
                'country' => $r->country,
            ], $results),
        ]);
    }

    #[Route('/geocode/reverse', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function reverse(Request $request): Response
    {
        $lat = (float) $request->query->get('lat', 0);
        $lng = (float) $request->query->get('lng', 0);

        try {
            $address = $this->geocoder->reverse($lng, $lat);
        } catch (RateLimitExceededException) {
            return new Response(null, 429);
        } catch (\Throwable $e) {
            $this->logger->error('Geocoding reverse failed', ['exception' => $e]);
            throw new ServiceUnavailableHttpException(null, 'Geocoding service unavailable', $e);
        }

        if (null === $address) {
            throw new NotFoundHttpException('No address found for the given coordinates');
        }

        return $this->json([
            'label' => $address->label,
            'street' => $address->street,
            'zip' => $address->zip,
            'city' => $address->city,
            'country' => $address->country,
        ]);
    }

    #[Route('/image/location/{id}', methods: ['GET'])]
    public function locationImage(string $id): Response
    {
        $location = $this->em->find(Location::class, $id);
        if (null === $location || null === $location->getLatitude() || null === $location->getLongitude()) {
            throw new NotFoundHttpException('Location not found or has no coordinates');
        }

        return $this->buildImageResponse($location->getLongitude(), $location->getLatitude());
    }

    #[Route('/image/event/{id}', methods: ['GET'])]
    public function eventImage(string $id): Response
    {
        $event = $this->em->find(Event::class, $id);
        // Public endpoint: drafts are not published anywhere, so their location is not either
        $location = null !== $event && !$event->isDraft() ? $event->getLocation() : null;
        if (null === $location || null === $location->getLatitude() || null === $location->getLongitude()) {
            throw new NotFoundHttpException('Event not found or has no location with coordinates');
        }

        return $this->buildImageResponse($location->getLongitude(), $location->getLatitude());
    }

    private function buildImageResponse(float $lng, float $lat): Response
    {
        try {
            $bytes = $this->mapImageProvider->getImage($lng, $lat, $this->imageZoom, $this->imageWidth, $this->imageHeight);
        } catch (RateLimitExceededException) {
            return new Response(null, 429);
        }

        return new Response($bytes, 200, [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }
}
