<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;
use Symfony\Component\Filesystem\Filesystem;

class SitemapControllerTest extends WebTestCase
{
    private string $dir;

    protected function setUp(): void
    {
        $this->dir = sys_get_temp_dir().'/cc-sitemap-ctl-'.bin2hex(random_bytes(4));
        putenv('STORAGE_LOCAL_PATH='.$this->dir);
    }

    protected function tearDown(): void
    {
        putenv('STORAGE_LOCAL_PATH');
        (new Filesystem())->remove($this->dir);
        parent::tearDown();
    }

    public function testMissingFilesAre404(): void
    {
        $client = static::createClient();
        foreach (['/sitemap.xml', '/sitemap-1.xml'] as $uri) {
            $client->request('GET', $uri);
            $this->assertSame(404, $client->getResponse()->getStatusCode(), $uri);
        }
    }

    public function testServesFilesWithCachingHeadersAnd304(): void
    {
        mkdir($this->dir.'/sitemap', 0777, true);
        file_put_contents($this->dir.'/sitemap/sitemap.xml', '<sitemapindex/>');
        file_put_contents($this->dir.'/sitemap/sitemap-2.xml', '<urlset/>');
        file_put_contents($this->dir.'/secret.txt', 'nope');
        $client = static::createClient();

        $client->request('GET', '/sitemap.xml');
        $response = $client->getResponse();
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('application/xml; charset=utf-8', $response->headers->get('Content-Type'));
        $this->assertStringContainsString('max-age=3600', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('public', (string) $response->headers->get('Cache-Control'));
        $this->assertSame('<sitemapindex/>', $client->getInternalResponse()->getContent());
        $etag = $response->headers->get('ETag');
        $this->assertNotEmpty($etag);
        $this->assertNotEmpty($response->headers->get('Last-Modified'));

        $client->request('GET', '/sitemap.xml', server: ['HTTP_IF_NONE_MATCH' => $etag]);
        $this->assertSame(304, $client->getResponse()->getStatusCode());

        $client->request('HEAD', '/sitemap-2.xml');
        $this->assertSame(200, $client->getResponse()->getStatusCode());
        $this->assertSame('', (string) $client->getInternalResponse()->getContent());

        $client->request('GET', '/sitemap-3.xml');
        $this->assertSame(404, $client->getResponse()->getStatusCode());
    }

    public function testOnlyStrictNamesAreRouted(): void
    {
        mkdir($this->dir.'/sitemap', 0777, true);
        file_put_contents($this->dir.'/sitemap/sitemap-01.xml', 'x');
        $client = static::createClient();
        foreach (['/sitemap-01.xml', '/sitemap-0.xml', '/sitemap-..%2Fsecret.txt.xml', '/sitemap-a.xml', '/sitemap-1.xml.bak', '/sitemap/sitemap.xml'] as $uri) {
            $client->request('GET', $uri);
            $this->assertNotSame(200, $client->getResponse()->getStatusCode(), $uri);
        }
    }
}
