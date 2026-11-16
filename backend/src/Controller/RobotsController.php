<?php

declare(strict_types=1);

namespace App\Controller;

use App\Service\InstanceVisibility;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * robots.txt from the instance policy. A private instance blocks everything except what crawlers need to read
 * the per-feed noindex signals (feed pages, feed API, assets) and the sitemap; the sitemap URL comes from APP_URL.
 */
#[AsController]
class RobotsController
{
    public function __construct(
        private readonly InstanceVisibility $visibility,
        #[Autowire(env: 'APP_URL')]
        private readonly string $appUrl,
    ) {
    }

    #[Route('/robots.txt', methods: ['GET'])]
    public function __invoke(): Response
    {
        $lines = ['User-agent: *'];
        if ($this->visibility->isPrivate()) {
            array_push($lines, 'Disallow: /', 'Allow: /feed/', 'Allow: /api/feed/', 'Allow: /assets/', 'Allow: /sitemap');
        } else {
            array_push(
                $lines,
                'Disallow: /api/',
                'Allow: /api/feed/',
                'Allow: /api/map/image/',
                'Disallow: /login',
                'Disallow: /signup',
                'Disallow: /forgot-password',
                'Disallow: /reset-password',
                'Disallow: /verify-email',
                'Disallow: /auth/',
                'Disallow: /invitations',
                'Disallow: /clubs',
                'Disallow: /setup',
                'Disallow: /oauth/',
                'Disallow: /profile',
            );
        }
        $lines[] = '';
        $lines[] = 'Sitemap: '.rtrim($this->appUrl, '/').'/sitemap.xml';

        return new Response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }
}
