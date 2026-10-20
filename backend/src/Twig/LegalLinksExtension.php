<?php

declare(strict_types=1);

namespace App\Twig;

use App\Service\LegalDocumentService;
use Twig\Extension\AbstractExtension;
use Twig\TwigFunction;

/**
 * `legal_links()` for the e-mail footer (`templates/email/_components/footer.mjml`): the public legal links
 * (imprint, privacy, terms; type => absolute URL, missing types omitted) from
 * {@see LegalDocumentService::publicLinks()}. Evaluated when a mail is rendered (memoized per instance, the footer asks twice) (also after the response in
 * {@see \App\Service\DeferredMailer} and in console commands), so no mailer has to pass it in.
 */
final class LegalLinksExtension extends AbstractExtension
{
    /** @var array<string, string>|null */
    private ?array $links = null;

    public function __construct(private readonly LegalDocumentService $legal)
    {
    }

    public function getFunctions(): array
    {
        return [new TwigFunction('legal_links', fn (): array => $this->links ??= $this->legal->publicLinks())];
    }
}
