<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Entity\User;
use App\Enum\LegalDocumentType;
use App\Repository\LegalDocumentRepository;
use App\Repository\UserConsentRepository;
use App\Service\LegalDocumentService;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Filesystem\Filesystem;

class LegalDocumentServiceTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private string $dir;
    private LegalDocumentService $service;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->dir = sys_get_temp_dir().'/legal-test-'.bin2hex(random_bytes(4));
        mkdir($this->dir);
        $this->service = new LegalDocumentService(
            $this->em,
            self::getContainer()->get(LegalDocumentRepository::class),
            self::getContainer()->get(UserConsentRepository::class),
            $this->dir,
        );
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->dir);
        parent::tearDown();
    }

    private function write(string $type, string $content): void
    {
        file_put_contents($this->dir.'/'.$type.'.md', $content);
    }

    private function user(string $email = 'a@example.com'): User
    {
        $user = new User();
        $user->setName('Test');
        $user->setEmail($email);
        $this->em->persist($user);
        $this->em->flush();

        return $user;
    }

    public function testDefaultPathInTestEnvironmentIsNotARealDirectory(): void
    {
        $default = self::getContainer()->get(LegalDocumentService::class);
        self::assertDirectoryDoesNotExist($default->getPath());
    }

    public function testEnumHelpers(): void
    {
        self::assertFalse(LegalDocumentType::IMPRINT->requiresConsent());
        self::assertSame([LegalDocumentType::PRIVACY, LegalDocumentType::TERMS], LegalDocumentType::consentTypes());
    }

    public function testMarkdownIsConvertedAndEscaped(): void
    {
        $html = $this->service->renderMarkdown("# Titel\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) **fett**");
        self::assertStringContainsString('<h1>Titel</h1>', $html);
        self::assertStringNotContainsString('<script>', $html);
        self::assertStringContainsString('&lt;script&gt;', $html);
        self::assertStringNotContainsString('javascript:', $html);
        self::assertStringContainsString('<strong>fett</strong>', $html);
    }

    public function testTitleExtraction(): void
    {
        self::assertSame('Datenschutz', $this->service->extractTitle("intro\n\n# Datenschutz\n\n## Sub"));
        self::assertNull($this->service->extractTitle("## Only sub\ntext"));
    }

    public function testSyncRules(): void
    {
        $report = $this->service->sync();
        self::assertSame(['imprint' => 'missing', 'privacy' => 'missing', 'terms' => 'missing'], $report);
        self::assertNull($this->service->current(LegalDocumentType::PRIVACY));

        $this->write('privacy', "# Privacy\n\nv1");
        $report = $this->service->sync();
        self::assertSame('created', $report['privacy']);
        $v1 = $this->service->current(LegalDocumentType::PRIVACY);
        self::assertNotNull($v1);
        self::assertSame('Privacy', $v1->getTitle());
        self::assertSame(hash('sha256', "# Privacy\n\nv1"), $v1->getContentHash());

        self::assertSame('unchanged', $this->service->sync()['privacy']);

        $this->write('privacy', "# Privacy\n\nv2");
        self::assertSame('created', $this->service->sync()['privacy']);
        $v2 = $this->service->current(LegalDocumentType::PRIVACY);
        self::assertNotSame($v1->getId(), $v2->getId());
        self::assertNotNull($this->service->find($v1->getId()));

        unlink($this->dir.'/privacy.md');
        self::assertSame('retired', $this->service->sync()['privacy']);
        self::assertNull($this->service->current(LegalDocumentType::PRIVACY));
        self::assertNotNull($this->service->find($v2->getId())->getRetiredAt());
        self::assertSame('missing', $this->service->sync()['privacy']);

        $this->write('privacy', "# Privacy\n\nv2");
        self::assertSame('restored', $this->service->sync()['privacy']);
        self::assertSame($v2->getId(), $this->service->current(LegalDocumentType::PRIVACY)?->getId());
        self::assertCount(2, self::getContainer()->get(LegalDocumentRepository::class)->findBy(['type' => LegalDocumentType::PRIVACY]));
    }

    public function testPendingConsentsAndRecording(): void
    {
        $this->write('imprint', '# Imprint');
        $this->write('privacy', '# Privacy');
        $this->write('terms', '# Terms');
        $this->service->sync();
        $user = $this->user();

        $pending = $this->service->pendingConsents($user);
        self::assertSame(['privacy', 'terms'], array_map(static fn ($d) => $d->getType()->value, $pending));

        $ua = str_repeat('x', 600);
        $this->service->recordConsents($user, [$pending[0]], '127.0.0.1', $ua);
        $this->service->recordConsents($user, [$pending[0], $pending[1]], '127.0.0.1', null);
        self::assertCount(2, $this->service->history($user));
        self::assertSame([], $this->service->pendingConsents($user));

        $this->em->clear();
        $history = $this->service->history($this->em->getRepository(User::class)->find($user->getId()));
        self::assertCount(2, $history);
        $withUa = array_values(array_filter($history, static fn ($c) => null !== $c->getUserAgent()));
        self::assertSame(512, strlen($withUa[0]->getUserAgent()));

        // a new version needs a new consent
        $this->write('terms', '# Terms v2');
        $this->service->sync();
        $user = $this->em->getRepository(User::class)->find($user->getId());
        $pending = $this->service->pendingConsents($user);
        self::assertSame(['terms'], array_map(static fn ($d) => $d->getType()->value, $pending));
        $this->service->recordConsents($user, $pending, null, null);
        self::assertCount(3, $this->service->history($user));
    }
}
