<?php

declare(strict_types=1);

namespace App\Tests\Controller;

use App\Enum\LegalDocumentType;
use App\Tests\Helper\DatabaseResetter;
use App\Tests\Helper\LegalTestHelper;
use App\Tests\Helper\TestHelper;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\KernelBrowser;
use Symfony\Bundle\FrameworkBundle\Test\WebTestCase;

class LegalControllerTest extends WebTestCase
{
    private static KernelBrowser $client;
    private static EntityManagerInterface $em;

    public static function setUpBeforeClass(): void
    {
        self::$client = static::createClient();
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
    }

    protected function setUp(): void
    {
        self::$em = static::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset(self::$em);
    }

    protected function tearDown(): void
    {
    }

    public function testIndexListsNullForMissingDocuments(): void
    {
        $privacy = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'Datenschutz');
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal');
        $this->assertSame(200, $r['status']);
        $this->assertNull($r['body']['imprint']);
        $this->assertNull($r['body']['terms']);
        $this->assertSame(['id', 'title', 'publishedAt'], array_keys($r['body']['privacy']));
        $this->assertSame($privacy->getId(), $r['body']['privacy']['id']);
        $this->assertSame('Datenschutz', $r['body']['privacy']['title']);
        $this->assertStringContainsString('max-age=60', $r['headers']['cache-control'][0]);
        $this->assertStringContainsString('public', $r['headers']['cache-control'][0]);
    }

    public function testCurrentDocumentOfAType(): void
    {
        LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT, 'Old', new \DateTimeImmutable('-2 days'));
        $new = LegalTestHelper::publish(self::$em, LegalDocumentType::IMPRINT, 'Impressum');
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/imprint');
        $this->assertSame(200, $r['status']);
        $this->assertSame($new->getId(), $r['body']['id']);
        $this->assertSame('imprint', $r['body']['type']);
        $this->assertSame('<h1>Impressum</h1>', $r['body']['html']);
        $this->assertArrayHasKey('publishedAt', $r['body']);
    }

    public function testMissingAndUnknownTypeAre404(): void
    {
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/terms');
        $this->assertSame(404, $r['status']);
        $this->assertSame('legal_document_not_found', $r['body']['code']);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/cookies');
        $this->assertSame(404, $r['status']);
        $this->assertSame('legal_document_not_found', $r['body']['code']);
    }

    public function testRetiredDocumentIsNotCurrentButStillReadableById(): void
    {
        $doc = LegalTestHelper::publish(self::$em, LegalDocumentType::TERMS);
        $doc->retire(new \DateTimeImmutable());
        self::$em->flush();
        $this->assertSame(404, TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/terms')['status']);
        $this->assertNull(TestHelper::jsonRequest(self::$client, 'GET', '/api/legal')['body']['terms']);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/documents/'.$doc->getId());
        $this->assertSame(200, $r['status']);
        $this->assertSame($doc->getId(), $r['body']['id']);
        $this->assertSame('terms', $r['body']['type']);
    }

    public function testOldVersionByIdAndUnknownId(): void
    {
        $old = LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v1', new \DateTimeImmutable('-3 days'));
        LegalTestHelper::publish(self::$em, LegalDocumentType::PRIVACY, 'v2');
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/documents/'.$old->getId());
        $this->assertSame('v1', $r['body']['title']);
        $r = TestHelper::jsonRequest(self::$client, 'GET', '/api/legal/documents/nope');
        $this->assertSame(404, $r['status']);
        $this->assertSame('legal_document_not_found', $r['body']['code']);
    }
}
