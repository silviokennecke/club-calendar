<?php

declare(strict_types=1);

namespace App\Controller;

use App\Sitemap\SitemapGenerator;
use League\Flysystem\FilesystemOperator;
use Symfony\Component\DependencyInjection\Attribute\Autowire;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Symfony\Component\HttpKernel\Attribute\AsController;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\Routing\Attribute\Route;

/** Serves the generated sitemap files from the file storage; only the exact generated names are reachable. */
#[AsController]
class SitemapController
{
    public function __construct(
        #[Autowire(service: 'app.storage', lazy: true)]
        private readonly FilesystemOperator $storage,
    ) {
    }

    #[Route('/sitemap.xml', methods: ['GET', 'HEAD'])]
    public function index(Request $request): Response
    {
        return $this->serve($request, 'sitemap.xml');
    }

    #[Route('/sitemap-{n}.xml', requirements: ['n' => '[1-9][0-9]{0,5}'], methods: ['GET', 'HEAD'])]
    public function part(Request $request, string $n): Response
    {
        return $this->serve($request, 'sitemap-'.$n.'.xml');
    }

    private function serve(Request $request, string $name): Response
    {
        $path = SitemapGenerator::DIRECTORY.'/'.$name;
        try {
            if (!$this->storage->fileExists($path)) {
                throw new NotFoundHttpException('Sitemap not found');
            }
            $modified = $this->storage->lastModified($path);
            $size = $this->storage->fileSize($path);
        } catch (NotFoundHttpException $e) {
            throw $e;
        } catch (\Throwable) {
            throw new NotFoundHttpException('Sitemap not found');
        }

        $headers = ['Content-Type' => 'application/xml; charset=utf-8'];
        $response = new StreamedResponse(function () use ($path): void {
            $stream = $this->storage->readStream($path);
            try {
                stream_copy_to_stream($stream, fopen('php://output', 'wb'));
            } finally {
                fclose($stream);
            }
        }, 200, $headers);
        $response->setEtag(sha1($name.'|'.$modified.'|'.$size));
        $response->setLastModified((new \DateTimeImmutable())->setTimestamp($modified));
        $response->setPublic();
        $response->setMaxAge(3600);
        $response->isNotModified($request);

        return $response;
    }
}
