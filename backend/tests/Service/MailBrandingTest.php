<?php

declare(strict_types=1);

namespace App\Tests\Service;

use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;
use Symfony\Contracts\Translation\TranslatorInterface;
use Twig\Environment;

/** The instance name (APP_NAME) shows up in mail subjects, texts and the compiled header/footer. */
class MailBrandingTest extends KernelTestCase
{
    private string|false $previous;

    protected function setUp(): void
    {
        $this->previous = getenv('APP_NAME');
        putenv('APP_NAME=Testverein Termine');
        $_ENV['APP_NAME'] = $_SERVER['APP_NAME'] = 'Testverein Termine';
        self::bootKernel();
    }

    protected function tearDown(): void
    {
        parent::tearDown();
        if (false === $this->previous) {
            putenv('APP_NAME');
            unset($_ENV['APP_NAME'], $_SERVER['APP_NAME']);
        } else {
            putenv('APP_NAME='.$this->previous);
            $_ENV['APP_NAME'] = $_SERVER['APP_NAME'] = $this->previous;
        }
    }

    public function testTranslationsCarryTheInstanceName(): void
    {
        $translator = self::getContainer()->get(TranslatorInterface::class);

        $this->assertSame('Dein Bestätigungscode für Testverein Termine', $translator->trans('email.verify.subject', [], 'messages', 'de'));
        $this->assertSame('Set a new password for Testverein Termine', $translator->trans('email.reset.subject', [], 'messages', 'en'));
    }

    public function testHeaderAndFooterCarryTheInstanceName(): void
    {
        $html = self::getContainer()->get(Environment::class)->render('email/verify_email.html.twig', [
            'userName' => 'Alice',
            'code' => '123456',
            'validMinutes' => '15',
            'email' => new \Symfony\Bridge\Twig\Mime\WrappedTemplatedEmail(
                self::getContainer()->get(Environment::class),
                new \Symfony\Bridge\Twig\Mime\TemplatedEmail(),
            ),
        ]);

        $this->assertGreaterThanOrEqual(2, substr_count($html, 'Testverein Termine'));
        $this->assertStringNotContainsString('Club Calendar', $html);
    }
}
