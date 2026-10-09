<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Names of properties, features and target groups are unique per calendar, ignoring case and
 * surrounding white space (same rule as the frontend). Checked in PHP rather than by a unique index:
 * existing duplicates stay untouched, and the database collation would also equate "ä" and "a".
 */
readonly class UniqueNames
{
    public const CODE = 'duplicate_name';

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * @param class-string $class entity with `calendar` and `name`
     *
     * @throws ApiProblemException 422 {code: duplicate_name, field: name}
     */
    public function assertUnique(string $class, Calendar $calendar, string $name, ?string $exceptId = null): void
    {
        $wanted = self::normalize($name);
        $rows = $this->em->createQueryBuilder()
            ->select('x.id', 'x.name')
            ->from($class, 'x')
            ->where('x.calendar = :cal')
            ->setParameter('cal', $calendar)
            ->getQuery()
            ->getArrayResult();

        foreach ($rows as $row) {
            if ($row['id'] !== $exceptId && self::normalize((string) $row['name']) === $wanted) {
                throw new ApiProblemException(422, sprintf('name: "%s" already exists in this calendar', trim($name)), self::CODE, 'name');
            }
        }
    }

    public static function normalize(string $name): string
    {
        // Strip white space like JavaScript's trim() (also no-break and other Unicode spaces)
        $trimmed = preg_replace('/^[\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]+|[\s\p{Zs}\x{FEFF}\x{2028}\x{2029}]+$/u', '', $name);

        return mb_strtolower($trimmed ?? trim($name));
    }
}
