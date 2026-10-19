<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\LegalDocument;
use App\Entity\User;
use App\Entity\UserConsent;
use App\Enum\LegalDocumentType;
use App\Repository\LegalDocumentRepository;
use App\Repository\UserConsentRepository;
use Doctrine\ORM\EntityManagerInterface;
use League\CommonMark\GithubFlavoredMarkdownConverter;
use Symfony\Component\DependencyInjection\Attribute\Autowire;

/**
 * Legal documents (imprint, privacy policy, terms): synchronises the Markdown files of the legal documents
 * directory into versioned `LegalDocument` rows and stores/reads the users' consents.
 */
class LegalDocumentService
{
    public const string CREATED = 'created';
    public const string UNCHANGED = 'unchanged';
    public const string RESTORED = 'restored';
    public const string RETIRED = 'retired';
    public const string MISSING = 'missing';

    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly LegalDocumentRepository $documents,
        private readonly UserConsentRepository $consents,
        #[Autowire('%app.legal_documents_path%')]
        private readonly string $path,
    ) {
    }

    public function getPath(): string
    {
        return $this->path;
    }

    /**
     * Compares the files with the stored versions.
     *
     * @return array<string, string> type value => created|unchanged|restored|retired|missing
     */
    public function sync(): array
    {
        $report = [];
        foreach (LegalDocumentType::cases() as $type) {
            $report[$type->value] = $this->syncType($type);
        }
        $this->em->flush();

        return $report;
    }

    private function syncType(LegalDocumentType $type): string
    {
        $file = rtrim($this->path, '/\\').'/'.$type->fileName();
        $latest = $this->documents->findLatest($type);
        $now = new \DateTimeImmutable();

        $raw = is_file($file) ? @file_get_contents($file) : false;
        if (false === $raw) {
            if (null !== $latest && !$latest->isRetired()) {
                $latest->retire($now);

                return self::RETIRED;
            }

            return self::MISSING;
        }

        $hash = hash('sha256', $raw);
        if (null !== $latest && $latest->getContentHash() === $hash) {
            if ($latest->isRetired()) {
                $latest->restore();

                return self::RESTORED;
            }

            return self::UNCHANGED;
        }

        $this->em->persist(new LegalDocument($type, $hash, $raw, $this->renderMarkdown($raw), $this->extractTitle($raw), $now));

        return self::CREATED;
    }

    public function renderMarkdown(string $markdown): string
    {
        $converter = new GithubFlavoredMarkdownConverter([
            'html_input' => 'escape',
            'allow_unsafe_links' => false,
        ]);

        return $converter->convert($markdown)->getContent();
    }

    /** The first level-1 heading (`# Title`), or null. */
    public function extractTitle(string $markdown): ?string
    {
        if (1 !== preg_match('/^# +(.+?)\s*#*\s*$/m', $markdown, $m)) {
            return null;
        }
        $title = trim($m[1]);

        return '' === $title ? null : mb_substr($title, 0, 255);
    }

    public function current(LegalDocumentType $type): ?LegalDocument
    {
        return $this->documents->findCurrent($type);
    }

    /** @return array<string, LegalDocument|null> type value => current document */
    public function currentAll(): array
    {
        $all = [];
        foreach (LegalDocumentType::cases() as $type) {
            $all[$type->value] = $this->current($type);
        }

        return $all;
    }

    /**
     * Current documents that need consent (privacy, terms), one query.
     *
     * @return array<string, LegalDocument> type value => document
     */
    public function currentOfConsentTypes(): array
    {
        return $this->documents->findCurrentOfTypes(LegalDocumentType::consentTypes());
    }

    /** Any version, retired ones included. */
    public function find(string $id): ?LegalDocument
    {
        return $this->documents->find($id);
    }

    /**
     * Current consent documents the user has not consented to yet (privacy, terms).
     *
     * @return list<LegalDocument>
     */
    public function pendingConsents(User $user): array
    {
        $current = [];
        foreach ($this->documents->findCurrentOfTypes(LegalDocumentType::consentTypes()) as $doc) {
            $current[$doc->getId()] = $doc;
        }
        $done = $this->consents->consentedDocumentIds($user, array_keys($current));

        return array_values(array_diff_key($current, array_flip($done)));
    }

    /**
     * Stores one consent per document; documents the user already consented to are skipped.
     *
     * @param list<LegalDocument> $documents
     */
    public function recordConsents(User $user, array $documents, ?string $ip, ?string $userAgent): void
    {
        $byId = [];
        foreach ($documents as $doc) {
            $byId[$doc->getId()] = $doc;
        }
        $done = array_flip($this->consents->consentedDocumentIds($user, array_keys($byId)));
        $now = new \DateTimeImmutable();
        foreach ($byId as $id => $doc) {
            if (!isset($done[$id])) {
                $this->em->persist(new UserConsent($user, $doc, $now, $ip, $userAgent));
            }
        }
        $this->em->flush();
    }

    /** @return list<UserConsent> newest first */
    public function history(User $user): array
    {
        return $this->consents->findHistory($user);
    }
}
