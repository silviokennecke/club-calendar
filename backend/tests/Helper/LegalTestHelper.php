<?php

declare(strict_types=1);

namespace App\Tests\Helper;

use App\Entity\LegalDocument;
use App\Enum\LegalDocumentType;
use Doctrine\ORM\EntityManagerInterface;

class LegalTestHelper
{
    public static function publish(EntityManagerInterface $em, LegalDocumentType $type, string $title = 'Title', ?\DateTimeImmutable $at = null): LegalDocument
    {
        $markdown = "# {$title}\n\nText of {$type->value} ".bin2hex(random_bytes(4));
        $doc = new LegalDocument($type, hash('sha256', $markdown), $markdown, '<h1>'.$title.'</h1>', $title, $at ?? new \DateTimeImmutable());
        $em->persist($doc);
        $em->flush();

        return $doc;
    }
}
