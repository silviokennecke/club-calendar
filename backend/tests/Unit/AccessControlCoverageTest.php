<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\RouterInterface;
use Symfony\Component\Security\Http\AccessMapInterface;

/**
 * Deny-by-default guard (audit L11): every `/api` route in the router must be matched by an `access_control`
 * rule, and only the routes listed here may be PUBLIC_ACCESS. A new public route has to be added to
 * security.yaml and to this list on purpose.
 */
class AccessControlCoverageTest extends KernelTestCase
{
    /** method|path regex of routes that are meant to be anonymously reachable. */
    private const array PUBLIC_PATTERNS = [
        '#^[A-Z]+ /api/health$#',
        '#^[A-Z]+ /api/legal(/|$)#',
        '#^[A-Z]+ /api/map/image/#',
        '#^[A-Z]+ /api/feed/#',
        '#^[A-Z]+ /api/mcp(/|$)#',
        '#^[A-Z]+ /api/oauth/(?!authorize/decision$|authorization-request/)#',
        '#^[A-Z]+ /api/auth/(login|registration|identify|token|logout|forgot-password|providers|verify-new-email)$#',
        '#^[A-Z]+ /api/auth/opaque/login/(start|finish)$#',
        '#^[A-Z]+ /api/auth/opaque/register/(start|finish)$#',
        '#^[A-Z]+ /api/auth/webauthn/authenticate/(options|verify)$#',
        '#^[A-Z]+ /api/auth/oauth/[^/]+/(callback|link)$#',
        '#^GET /api/auth/oauth/[^/]+$#',
        '#^POST /api/invitations/preview$#',
    ];

    public function testEveryApiRouteIsCoveredAndOnlyAllowListedOnesArePublic(): void
    {
        self::bootKernel();
        $container = static::getContainer();
        $router = $container->get(RouterInterface::class);
        $accessMap = $container->get('security.access_map');
        self::assertInstanceOf(AccessMapInterface::class, $accessMap);

        $checked = 0;
        foreach ($router->getRouteCollection() as $name => $route) {
            $path = $route->getPath();
            if (!str_starts_with($path, '/api')) {
                continue;
            }
            $sample = preg_replace('/\{[^}]+\}/', 'x', $path);
            foreach ($route->getMethods() ?: ['GET'] as $method) {
                [$attributes] = $accessMap->getPatterns(Request::create($sample, $method));
                $label = "$method $path ($name)";
                self::assertNotNull($attributes, "No access_control rule matches $label");

                $isPublic = \in_array('PUBLIC_ACCESS', $attributes, true);
                $listed = false;
                foreach (self::PUBLIC_PATTERNS as $pattern) {
                    if (preg_match($pattern, "$method $sample")) {
                        $listed = true;
                        break;
                    }
                }
                self::assertSame($listed, $isPublic, "Public/authenticated mismatch for $label");
                ++$checked;
            }
        }
        self::assertGreaterThan(50, $checked);
    }
}
