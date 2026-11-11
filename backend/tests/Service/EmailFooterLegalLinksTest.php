<?php

declare(strict_types=1);

namespace App\Tests\Service;

use App\Repository\LegalDocumentRepository;
use App\Repository\UserConsentRepository;
use App\Service\LegalDocumentService;
use App\Tests\Helper\DatabaseResetter;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bridge\Twig\Mime\TemplatedEmail;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Component\Filesystem\Filesystem;

/** Legal links in the footer of the e-mails (`footer.mjml`, Twig function `legal_links()`). */
class EmailFooterLegalLinksTest extends KernelTestCase
{
    private EntityManagerInterface $em;
    private string $dir;

    protected function setUp(): void
    {
        self::bootKernel();
        $this->em = self::getContainer()->get(EntityManagerInterface::class);
        DatabaseResetter::reset($this->em);
        $this->dir = sys_get_temp_dir().'/legal-mail-test-'.bin2hex(random_bytes(4));
        mkdir($this->dir);
    }

    protected function tearDown(): void
    {
        (new Filesystem())->remove($this->dir);
        parent::tearDown();
    }

    /** @param array<string, string> $links */
    private function sync(array $links = []): void
    {
        (new LegalDocumentService(
            $this->em,
            self::getContainer()->get(LegalDocumentRepository::class),
            self::getContainer()->get(UserConsentRepository::class),
            $this->dir,
            $links,
        ))->sync();
    }

    /** Renders like the mailers do (TemplatedEmail + body renderer: `email.image()` needs it). */
    private function render(string $template, string $locale = 'de'): string
    {
        $message = new TemplatedEmail()
            ->from('noreply@example.com')->to('a@example.com')
            ->htmlTemplate($template)
            ->locale($locale)
            ->context([
                'name' => 'Tester', 'code' => '123456', 'clubName' => 'Club', 'inviterName' => 'Ann',
                'invitationUrl' => 'https://x.test/i', 'registerUrl' => 'https://x.test/s', 'validDays' => 7,
                'userName' => 'Tester', 'forgotUrl' => 'https://x.test/f', 'when' => 'now', 'zone' => 'UTC',
                'date' => '2026-01-01', 'time' => '12:00', 'maskedEmail' => 'a***@example.com',
                'newEmail' => 'b@example.com', 'validMinutes' => 15, 'resetUrl' => 'https://x.test/r',
                'confirmUrl' => 'https://x.test/c', 'ip' => '203.0.113.1', 'place' => 'Berlin', 'browser' => 'Chrome 126', 'count' => 3,
            ]);
        self::getContainer()->get('twig.mime_body_renderer')->render($message);

        return (string) $message->getHtmlBody();
    }

    public function testDocumentAndExternalLinksAreRendered(): void
    {
        file_put_contents($this->dir.'/privacy.md', "# Datenschutz\n\nText");
        $this->sync(['imprint' => 'https://example.org/impressum']);

        $html = $this->render('email/verify_email.html.twig');

        self::assertStringContainsString('href="https://example.org/impressum"', $html);
        self::assertStringContainsString('>Impressum</a>', $html);
        self::assertMatchesRegularExpression('#href="[^"]+/privacy"[^>]*>Datenschutz</a>#', $html);
        self::assertStringNotContainsString('Nutzungsbedingungen', $html);
        self::assertStringContainsString('&middot;', $html);
    }

    public function testEnglishLabelsAndOtherTemplate(): void
    {
        file_put_contents($this->dir.'/terms.md', "# Terms\n\nText");
        $this->sync();

        $html = $this->render('email/club_invitation.html.twig', 'en');

        self::assertMatchesRegularExpression('#href="[^"]+/terms"[^>]*>Terms of use</a>#', $html);
        self::assertStringNotContainsString('&middot;', $html);
    }

    public function testNoLinksNoLine(): void
    {
        $this->sync();

        foreach (['verify_email', 'club_invitation', 'password_changed'] as $name) {
            $html = $this->render('email/'.$name.'.html.twig');
            self::assertStringNotContainsString('Impressum', $html, $name);
            self::assertStringNotContainsString('Datenschutz</a>', $html, $name);
            self::assertStringNotContainsString('&middot;', $html, $name);
        }
    }
}
