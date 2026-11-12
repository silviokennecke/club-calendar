<?php

declare(strict_types=1);

namespace App\Tests\Unit;

use App\Entity\User;
use App\Export\ClubContentExporter;
use App\Export\UserDataExportService;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Mapping\ClassMetadata;
use Symfony\Bundle\FrameworkBundle\Test\KernelTestCase;

/**
 * Drift guard for the GDPR export: a new entity that links to a user (or carries the audit fields) must be
 * added to UserDataExportService::COVERAGE as exported or deliberately excluded.
 */
class UserDataExportCoverageTest extends KernelTestCase
{
    public function testEveryUserLinkedEntityIsRegistered(): void
    {
        self::bootKernel();
        $em = static::getContainer()->get(EntityManagerInterface::class);

        $required = [];
        /** @var ClassMetadata<object> $meta */
        foreach ($em->getMetadataFactory()->getAllMetadata() as $meta) {
            if (User::class === $meta->getName()) {
                $required[] = $meta->getName();
                continue;
            }
            foreach ($meta->getFieldNames() as $field) {
                if (1 === preg_match('/^(user|createdBy|invitedBy|updatedBy)(Id)?$/', $field)) {
                    $required[] = $meta->getName();
                    continue 2;
                }
            }
            foreach ($meta->getAssociationMappings() as $mapping) {
                if (User::class === $mapping->targetEntity) {
                    $required[] = $meta->getName();
                    break;
                }
            }
        }

        $missing = array_values(array_diff($required, array_keys(UserDataExportService::COVERAGE)));
        self::assertSame(
            [],
            $missing,
            "Entities linked to a user are neither exported nor excluded in the user data export; add them to UserDataExportService::COVERAGE (and export them or give a reason):\n - ".implode("\n - ", $missing),
        );
    }

    public function testRegistryHasNoStaleEntriesAndValidFormat(): void
    {
        self::bootKernel();
        $em = static::getContainer()->get(EntityManagerInterface::class);
        $known = array_map(static fn (ClassMetadata $m) => $m->getName(), $em->getMetadataFactory()->getAllMetadata());

        foreach (UserDataExportService::COVERAGE as $class => $status) {
            self::assertContains($class, $known, "$class in COVERAGE is not a mapped entity any more");
            self::assertMatchesRegularExpression('/^(exported|excluded):\S.*$/', $status, "Bad COVERAGE entry for $class");
        }
    }

    public function testClubContentCoversEveryAuditedEntity(): void
    {
        $audited = [];
        foreach (UserDataExportService::COVERAGE as $class => $status) {
            if ('exported:clubContent' === $status) {
                $audited[] = (new \ReflectionClass($class))->getShortName();
            }
        }
        $types = array_map('ucfirst', ClubContentExporter::types());
        foreach ($audited as $short) {
            self::assertContains($short, $types, "$short is registered as clubContent but ClubContentExporter has no query for it");
        }
    }
}
