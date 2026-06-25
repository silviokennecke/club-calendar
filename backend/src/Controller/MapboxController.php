<?php
declare(strict_types=1);

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpClient\HttpClient;
use Symfony\Component\Routing\Attribute\Route;

#[Route('/api/mapbox')]
class MapboxController extends AbstractController
{
    /** @var string[] */
    private const ALLOWED_DOMAINS = ['api.mapbox.com'];

    /** @var string[] */
    private const DROP_HEADERS = [
        'transfer-encoding', 'content-encoding', 'content-length',
        'connection', 'keep-alive', 'te', 'trailer', 'upgrade',
    ];

    #[Route('/{path}', name: 'mapbox_proxy', requirements: ['path' => '.+'], methods: ['GET', 'POST', 'PUT', 'PATCH'])]
    public function proxy(string $path, Request $request): Response
    {
        $mapboxToken = $_ENV['MAPBOX_TOKEN'] ?? '';
        if (!$mapboxToken) {
            return new Response(
                json_encode(['error' => 'Map service not configured']),
                503,
                ['Content-Type' => 'application/json'],
            );
        }

        // path = "{domain}/{rest...}"
        $parts  = explode('/', $path, 2);
        $domain = $parts[0] ?? '';
        $rest   = '/' . ($parts[1] ?? '');

        if (!in_array($domain, self::ALLOWED_DOMAINS, true)) {
            return new Response(
                json_encode(['error' => "Domain not allowed: $domain"]),
                400,
                ['Content-Type' => 'application/json'],
            );
        }

        // Build query params, strip access_token, inject MAPBOX_TOKEN
        $params = [];
        foreach ($request->query->all() as $k => $v) {
            if ($k === 'access_token') continue;
            $params[$k] = $v;
        }
        $params['access_token'] = $mapboxToken;

        $upstreamUrl = "https://$domain$rest?" . http_build_query($params);

        $options = ['headers' => []];
        if (in_array($request->getMethod(), ['POST', 'PUT', 'PATCH'], true) && $request->getContent()) {
            $options['body']    = $request->getContent();
            $options['headers']['Content-Type'] = $request->headers->get('Content-Type', 'application/json');
        }

        $client = HttpClient::create();
        try {
            $upstream = $client->request($request->getMethod(), $upstreamUrl, $options);
            $status   = $upstream->getStatusCode();
            $headers  = [];
            foreach ($upstream->getHeaders(false) as $name => $values) {
                if (!in_array(strtolower($name), self::DROP_HEADERS, true)) {
                    $headers[$name] = implode(', ', $values);
                }
            }
            $content = $upstream->getContent(false);
            return new Response($content, $status, $headers);
        } catch (\Throwable) {
            return new Response(
                json_encode(['error' => 'Failed to reach map service']),
                502,
                ['Content-Type' => 'application/json'],
            );
        }
    }
}
