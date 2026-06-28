<?php
declare(strict_types=1);

namespace App\Controller;

use App\Service\Map\GeocoderInterface;
use App\Service\Map\MapImageProviderInterface;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;
use Symfony\Contracts\Cache\CacheInterface;
use Symfony\Contracts\Cache\ItemInterface;

#[Route('/api/map')]
class MapController extends AbstractController
{
    private const IMAGE_WIDTH  = 800;
    private const IMAGE_HEIGHT = 288;
    private const IMAGE_ZOOM   = 14;

    public function __construct(
        private readonly GeocoderInterface $geocoder,
        private readonly MapImageProviderInterface $mapImageProvider,
        private readonly EntityManagerInterface $em,
        private readonly CacheInterface $mapImagesCache,
    ) {}

    #[Route('/geocode/suggest', methods: ['GET'])]
    #[IsGranted('ROLE_USER')]
    public function suggest(Request $request): Response
    {
        $query = trim((string) $request->query->get('q', ''));
        if ($query === '') {
            return $this->json(['suggestions' => []]);
        }

        $lat   = $request->query->has('lat') ? (float) $request->query->get('lat') : null;
        $lng   = $request->query->has('lng') ? (float) $request->query->get('lng') : null;
        $limit = max(1, min(10, (int) $request->query->get('limit', 6)));

        try {
            $results = $this->geocoder->suggest($query, $lat, $lng, $limit);
        } catch (\Throwable) {
            return $this->json(['error' => 'Geocoding service unavailable'], 503);
        }

        return $this->json([
            'suggestions' => array_map(fn($r) => [
                'label'   => $r->label,
                'lat'     => $r->lat,
                'lng'     => $r->lng,
                'street'  => $r->street,
                'zip'     => $r->zip,
                'city'    => $r->city,
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
        } catch (\Throwable) {
            return $this->json(['error' => 'Geocoding service unavailable'], 503);
        }

        if ($address === null) {
            return $this->json(['error' => 'No address found'], 404);
        }

        return $this->json([
            'label'   => $address->label,
            'street'  => $address->street,
            'zip'     => $address->zip,
            'city'    => $address->city,
            'country' => $address->country,
        ]);
    }

    #[Route('/image/location/{id}', methods: ['GET'])]
    public function locationImage(string $id): Response
    {
        $location = $this->em->find(\App\Entity\Location::class, $id);
        if ($location === null || $location->getLatitude() === null || $location->getLongitude() === null) {
            return new Response('', 404);
        }

        return $this->buildImageResponse($location->getId(), $location->getLongitude(), $location->getLatitude());
    }

    #[Route('/image/event/{id}', methods: ['GET'])]
    public function eventImage(string $id): Response
    {
        $event    = $this->em->find(\App\Entity\Event::class, $id);
        $location = $event?->getLocation();
        if ($location === null || $location->getLatitude() === null || $location->getLongitude() === null) {
            return new Response('', 404);
        }

        return $this->buildImageResponse($location->getId(), $location->getLongitude(), $location->getLatitude());
    }

    private function buildImageResponse(string $locationId, float $lng, float $lat): Response
    {
        $bytes = $this->mapImagesCache->get(
            'location_' . $locationId,
            function (ItemInterface $item) use ($lng, $lat): string {
                return $this->mapImageProvider->getImage($lng, $lat, self::IMAGE_ZOOM, self::IMAGE_WIDTH, self::IMAGE_HEIGHT);
            },
        );

        return new Response($bytes, 200, [
            'Content-Type'  => 'image/jpeg',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }
}
