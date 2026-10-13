<?php

declare(strict_types=1);

namespace App\Service;

use App\Entity\Calendar;
use App\Exception\ApiProblemException;
use Doctrine\ORM\EntityManagerInterface;

/**
 * Resolves ids from request bodies (location, properties, features, target groups, templates) to
 * records of ONE calendar. Unknown ids and ids of other calendars are rejected alike (422), so that
 * nothing about other calendars leaks and no foreign data can be linked.
 * Errors: 422 `code: unknown_reference` with the input `field`.
 */
readonly class CalendarReferences
{
    public const CODE = 'unknown_reference';

    public function __construct(private EntityManagerInterface $em)
    {
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $class
     *
     * @return T|null null for an empty value (null or "")
     */
    public function find(string $class, Calendar $calendar, mixed $id, string $field): ?object
    {
        if (null === $id || '' === $id) {
            return null;
        }
        if (!is_string($id) && !is_int($id)) {
            throw Input::invalid($field, sprintf('%s must be an id', $field));
        }

        $found = $this->findAll($class, $calendar, [(string) $id], $field);

        return reset($found) ?: null;
    }

    /**
     * @template T of object
     *
     * @param class-string<T> $class
     * @param list<string>    $ids   unique ids (see Input::idList)
     *
     * @return array<string, T> by the stored id (the database compares ids case-insensitively, so
     *                          "ABC…" and "abc…" find the same record and must not be linked twice)
     */
    public function findAll(string $class, Calendar $calendar, array $ids, string $field): array
    {
        $found = [];
        foreach ($ids as $id) {
            $entity = $this->em->getRepository($class)->find($id);
            if (null === $entity || $entity->getCalendar()->getId() !== $calendar->getId()) {
                throw self::unknown($field, $id);
            }
            $found[$entity->getId()] = $entity;
        }

        return $found;
    }

    public static function unknown(string $field, string $id): ApiProblemException
    {
        return new ApiProblemException(422, sprintf('%s: unknown id "%s" in this calendar', $field, $id), self::CODE, $field);
    }
}
